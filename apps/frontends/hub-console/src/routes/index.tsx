import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { withRequestContext } from '../lib/request-context.ts';
import { apiClient } from '../lib/api.ts';
import { Badge, Button, EmptyState, ErrorState, Spinner } from '@zipzap/ui';
import { useAsync } from '../lib/useAsync.ts';
import { Logo } from '../lib/brand.tsx';
import { statusLabel } from '../lib/scans.ts';

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
   * then redirected — the hub picker flashed at an unauthenticated visitor before the check ran.
   * `beforeLoad` runs before any component renders, so a `redirect()` thrown here is a redirect
   * with no flash and no fetch the browser had to make first.
   *
   * `redirect` rather than a thrown `Error`: TanStack Router treats a thrown `redirect()` as a
   * navigation, and treats any other throw as an error boundary — which would render an error page
   * where the hub picker belongs.
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
  component: HubPicker,
});

/**
 * The hub picker, which is also the console's front door.
 *
 * A hub operator arrives here having just chosen their own depot from a wall of shared tablets, so
 * the first question is never "what do you want" — it is "which building are you in". Every row is
 * therefore a full-width target rather than a table cell: `countAtHub` is the number that matters
 * before anything else, because a hub with 40 parcels waiting is a different morning from one with 0.
 */
function HubPicker() {
  const navigate = useNavigate();
  const hubs = useAsync(() => apiClient().hubs());

  async function signOut() {
    try {
      // Revokes server-side and clears the cookie. Without the cleartext the tablet would keep
      // sending a session the server has already refused — and this one is shared at the door.
      await apiClient().logout();
    } finally {
      void navigate({ to: '/login' });
    }
  }

  // Sorted busiest-first: the operator is standing in one of these rooms and wants *their* room,
  // and on a 5" screen the hub with 40 parcels waiting is the one worth reading.
  const ordered = [...(hubs.data ?? [])].sort((a, b) => b.countAtHub - a.countAtHub);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Logo className="size-8" />
            <span className="font-semibold">Hub console</span>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Choose your hub</h1>
            <p className="mt-1 text-sm text-slate-600">
              {hubs.loading ? 'Loading hubs…' : `${ordered.length} hubs on the network`}
            </p>
          </div>
          {/* Manifests are not per-hub, so they are not on the hub screen. */}
          <Link to="/manifests">
            <Button variant="secondary">Manifests</Button>
          </Link>
        </div>

        {hubs.error ? (
          <ErrorState message={hubs.error} retry={hubs.reload} />
        ) : hubs.loading ? (
          <div className="mt-6 flex justify-center py-10">
            <Spinner />
          </div>
        ) : ordered.length === 0 ? (
          <EmptyState
            title="No hubs yet"
            description="This token can read hubs and none are seeded. Run the seed script."
          />
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {ordered.map((hub) => (
              <li key={hub.id}>
                <Link
                  to="/hubs/$hubCode"
                  params={{ hubCode: hub.code }}
                  className="flex min-h-16 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 active:bg-slate-100"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-900">{hub.name}</span>
                    <span className="mt-0.5 block truncate text-sm text-slate-500">
                      {hub.code}
                      {hub.networkZone ? ` · ${statusLabel(hub.networkZone)}` : ''}
                    </span>
                  </span>
                  <Badge tone={hub.countAtHub === 0 ? 'neutral' : 'info'}>
                    {hub.countAtHub} waiting
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
