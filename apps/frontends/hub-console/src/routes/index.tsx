import { createFileRoute, isRedirect, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { withRequestContext } from '../lib/request-context.ts';
import { apiClient } from '../lib/api.ts';

/**
 * Resolves the principal on the SERVER, from the request context the global middleware captured.
 *
 * The cookie is `HttpOnly`, so it cannot be read by script — which is exactly why this has to run
 * on the server: a client-side check would be asking the browser about a cookie the browser is not
 * allowed to disclose. `withRequestContext` carries the header across the boundary, and the client
 * resolves its relative `/api` base URL against the origin the request arrived on.
 */
const loadPrincipal = createServerFn({ method: 'GET' })
  .middleware([withRequestContext])
  .handler(async ({ context }) => {
    const client = apiClient({
      onRequest: (url, init) => {
        const absolute = new URL(url, context.origin);
        const headers = new Headers(init.headers as HeadersInit | undefined);
        if (context.cookie) headers.set('cookie', context.cookie);
        return { ...init, url: absolute.toString(), headers };
      },
    });
    return client.getMe();
  });

export const Route = createFileRoute('/')({
  /**
   * `/` is a router, not a screen: it has no UI of its own, it answers "you are signed in, go
   * somewhere" or "you are not, go and sign in".
   *
   * The redirect to `/my-hub` is thrown OUTSIDE the try, which is the whole shape of this function.
   * Inside it, the catch would swallow the redirect it was meant to pass on and replace it with a
   * `/login` — and `redirect()` is a `Response`, not an `Error`, so the `e instanceof Error` test
   * meant to recognise it could not fire. The result was a signed-in operator bouncing between `/`
   * and `/login` forever, which reads as a broken session rather than a swallowed redirect: the login
   * succeeds, the cookie is set, and the app still will not open.
   *
   * `isRedirect` is the router's own check, and it is used for the other half below for the same
   * reason — a test written against the wrong shape of the thrown value fails open.
   */
  beforeLoad: async () => {
    try {
      await loadPrincipal();
    } catch (e) {
      if (isRedirect(e)) throw e;
      // The cookie is missing, expired or revoked. See the note in merchant-web's `/app` guard for
      // why it is not cleared here: it is `HttpOnly`, so no code on this page can reach it.
      throw redirect({ to: '/login' });
    }
    // Outside the try, for the reason in the comment above.
    throw redirect({ to: '/my-hub' });
  },
});
