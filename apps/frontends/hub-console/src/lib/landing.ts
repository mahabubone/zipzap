/**
 * Where the landing page sends you, decided without a router.
 *
 * `/` is a router, not a screen. It answers "you are signed in, go somewhere" or "you are not, go
 * and sign in", and it has no UI of its own. The decision is pulled out here because the shape of this
 * code is the bug: the decision is *which way an exception travels*, and that is exactly what a test
 * can pin and a code review reads past.
 *
 * ## The bug this exists to prevent
 *
 * The original was:
 *
 * ```ts
 * try { await loadPrincipal(); }
 * catch (e) {
 *   if (e instanceof Error && 'isRedirect' in e) throw e;   // never fires
 *   throw redirect({ to: '/login' });
 * }
 * throw redirect({ to: '/my-hub' });
 * ```
 *
 * Two mistakes in four lines. `redirect()` returns a **Response**, not an Error, so
 * `e instanceof Error` was false for the one value it was written to recognise — the guard could not
 * fire, and a redirect raised by the session load was replaced by a redirect to `/login`. And the
 * redirect after the try was *inside* the try in the first draft, where the catch would swallow it
 * and send the operator to `/login` for having signed in successfully.
 *
 * The symptom was a signed-in operator bouncing between `/` and `/login` forever, which reads as a
 * broken session rather than a swallowed redirect: the login succeeds, the cookie is set, and the
 * app still will not open. Nothing throws, no console shows an error, and the session looks correct
 * from every tool that reports on it.
 *
 * So: the redirect decision is now a value, the pass-through is explicit, and the test suite below
 * asserts that a redirect thrown by the loader comes out the other side as **itself**.
 */

/** Where to send someone who lands on `/`. */
export type Landing = { readonly to: '/my-hub' } | { readonly to: '/login' };

/** Any router's redirect check, injected so this file needs no router. */
export type IsRedirect = (error: unknown) => boolean;

export interface LandingOptions {
  /** Resolves the principal. Rejects when the cookie is missing, expired or revoked. */
  readonly load: () => Promise<unknown>;
  /** The router's own `isRedirect`. Injected so this stays testable and framework-free. */
  readonly isRedirect: IsRedirect;
}

/**
 * Resolve a principal and say where to send the visitor.
 *
 * Throws only when the loader itself threw something that must travel unchanged — a redirect. Every
 * other failure is an absent session, which is a landing, not an exception.
 */
export async function landing({ load, isRedirect }: LandingOptions): Promise<Landing> {
  try {
    await load();
  } catch (error) {
    // First, and not as part of the condition below: a redirect is a control-flow signal, and
    // rewriting it as "there is no session" is how a signed-in person ends up at the login form.
    if (isRedirect(error)) throw error;

    // The cookie is missing, expired or revoked. It is not cleared here, and cannot be: it is
    // `HttpOnly`, so no code on this page is able to reach it. The server drops it when it expires.
    return { to: '/login' };
  }

  return { to: '/my-hub' };
}
