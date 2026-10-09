import { useEffect, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, ErrorState, Spinner } from '@zipzap/ui';
import { apiClient } from '../lib/api.ts';
import { clearSession, readSession } from '../lib/session.ts';
import { useAsync } from '../lib/useAsync.ts';
import { NetworkList, NetworkMap } from '../lib/network-map.tsx';

export const Route = createFileRoute('/')({
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

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Control tower</h1>
            {network.data ? (
              <p className="text-xs text-slate-500">
                Snapshot {new Date(network.data.generatedAt).toLocaleTimeString('en-GB')} ·{' '}
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
          <NetworkMap
            hubs={network.data.hubs}
            riders={network.data.riders}
            onFallback={setFallback}
          />
        )}
      </main>
    </div>
  );
}
