import { useEffect } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Badge, Button, EmptyState, ErrorState, Spinner } from '@zipzap/ui';
import { apiClient } from '../lib/api.ts';
import { clearSession, readSession } from '../lib/session.ts';
import { useAsync } from '../lib/useAsync.ts';
import { Logo } from '../lib/brand.tsx';
import { statusLabel } from '../lib/scans.ts';

export const Route = createFileRoute('/')({
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

  useEffect(() => {
    if (!readSession()) void navigate({ to: '/login' });
  }, [navigate]);

  async function signOut() {
    try {
      await apiClient().logout();
    } finally {
      clearSession();
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
