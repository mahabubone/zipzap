import { useState } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { withRequestContext } from '../lib/request-context.ts';
import { apiClient } from '../lib/api.ts';
import { BrandMark, Button, ErrorState, Spinner } from '@zipzap/ui';
import { formatWhen, useAsync } from '@zipzap/web-kit';
import { NetworkList } from '../lib/network-list.tsx';
import { MapFrame } from '../lib/map-frame.tsx';

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
   * The guard, on the server.
   *
   * It used to be a `useEffect` in the screen, which meant `/` was rendered, shipped, hydrated and
   * then redirected — a full page of console flashed at an unauthenticated visitor before the check
   * ran. `beforeLoad` runs before any component renders, so a `redirect()` thrown here is a
   * redirect with no flash and no fetch the browser had to make first.
   *
   * `redirect` rather than a thrown `Error`: TanStack Router treats a thrown `redirect()` as a
   * navigation, and treats any other throw as an error boundary — which would render an error page
   * where the console belongs.
   */
  beforeLoad: async () => {
    try {
      return { principal: await loadPrincipal() };
    } catch {
      // The cookie is missing, expired or revoked.
      //
      // It is not cleared here, and cannot be: it is `HttpOnly`, so no code on this page can touch
      // it, and `logout` refuses a request that arrives without a valid session. A cookie with a
      // past expiry dies on the browser's own clock; a revoked one stops being honoured the moment
      // the server revokes it. Either way the next `login` replaces it.
      throw redirect({ to: '/login' });
    }
  },
  component: Network,
});

/**
 * The live network.
 *
 * The map is the point, and the list is the fallback — but the relationship between them is the whole
 * design. Markers are drawn by this app from coordinates the API returned; tiles are a background
 * decoration from a third party. So the map is never *dependent* on the tile server, it is merely
 * *less useful* without it, and when the tiles stop arriving the screen swaps itself to the list
 * automatically rather than leaving an operator with a grey rectangle and a spinner.
 */
function Network() {
  const navigate = useNavigate();
  const network = useAsync(() => apiClient().networkMap());
  const [fallback, setFallback] = useState<string | null>(null);

  async function signOut() {
    try {
      // Revokes server-side and clears the cookie. Without the cleartext the browser would keep
      // sending a session the server has already refused.
      await apiClient().logout();
    } finally {
      void navigate({ to: '/login' });
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-3">
          <div>
            <div className="flex items-center gap-2">
              <BrandMark className="size-6" />
              <h1 className="text-lg font-semibold tracking-tight">Control tower</h1>
            </div>
            {network.data ? (
              /* Asia/Dhaka, via the kit — `toLocaleTimeString()` with no arguments reads in the
                 reader's own timezone, so two people comparing the same board could see two times for
                 the same snapshot. */
              <p className="text-xs text-slate-500">
                Snapshot {formatWhen(network.data.generatedAt)} ·{' '}
                {network.data.ridersWithoutPosition} riders have never reported
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={network.reload}>
              Refresh
            </Button>
            <Button variant="secondary" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        {network.error ? (
          <ErrorState message={network.error} retry={network.reload} />
        ) : network.loading || !network.data ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : fallback ? (
          <NetworkList
            hubs={network.data.hubs}
            riders={network.data.riders}
            reason={fallback}
            onRetry={() => setFallback(null)}
          />
        ) : (
          /*
            `MapFrame`, not `NetworkMap`.

            `network-map.tsx` imports `react-leaflet`, and Leaflet reads `window` at module scope — so
            the server threw `window is not defined` while rendering this route, TanStack Start
            caught it, and the entire screen quietly fell back to client rendering. It looked fine in
            a browser, which is why it survived: the only symptom was that a direct GET of the ops
            console never server-rendered, and that symptom is invisible unless you read for it.

            `MapFrame` renders the map's container and the counts — server-rendered, no Leaflet — and
            swaps the real map in once the client has taken over.
          */
          <MapFrame
            hubs={network.data.hubs}
            riders={network.data.riders}
            onFallback={setFallback}
          />
        )}
      </main>
    </div>
  );
}
