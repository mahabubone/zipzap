import { createFileRoute, isRedirect, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { withRequestContext } from '../lib/request-context.ts';
import { apiClient } from '../lib/api.ts';
import { landing } from '../lib/landing.ts';

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
   * The decision lives in `lib/landing.ts`, which has a test suite, because the shape of this code
   * *is* the bug it had. This version once caught every failure and asked `e instanceof Error` to
   * recognise a redirect — but `redirect()` returns a `Response`, not an `Error`, so the guard could
   * not fire and a signed-in operator bounced between `/` and `/login` forever. Nothing threw, no
   * console showed an error, and the session looked correct from every tool that reports on it.
   *
   * `isRedirect` is the router's own check, passed in rather than imported, so the decision is
   * testable without a router and a test written against the wrong shape of the thrown value fails
   * loudly instead of failing open.
   */
  beforeLoad: async () => {
    const destination = await landing({ load: () => loadPrincipal(), isRedirect });
    throw redirect({ to: destination.to });
  },
});
