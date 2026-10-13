import { createFileRoute, redirect } from '@tanstack/react-router';
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
  beforeLoad: async () => {
    try {
      await loadPrincipal();
      // User is authenticated, redirect to /my-hub
      throw redirect({ to: '/my-hub' });
    } catch (e) {
      // If it's a redirect, rethrow it
      if (e instanceof Error && 'isRedirect' in e) throw e;
      // Otherwise cookie is missing/expired, redirect to login
      throw redirect({ to: '/login' });
    }
  },
});
