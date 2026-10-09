import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Badge, Button, EmptyState, ErrorState, Spinner } from '@zipzap/ui';
import type { ManifestStatus } from '@zipzap/api-client';
import { apiClient } from '../lib/api.ts';
import { useAsync } from '../lib/useAsync.ts';
import { statusLabel } from '../lib/scans.ts';

export const Route = createFileRoute('/manifests/')({
  component: ManifestList,
});

const FILTERS: ReadonlyArray<ManifestStatus | 'ALL'> = [
  'ALL',
  'DRAFT',
  'SEALED',
  'DISPATCHED',
  'RECEIVED',
  'RECONCILED',
];

const TONE: Record<ManifestStatus, 'neutral' | 'info' | 'success' | 'warning'> = {
  DRAFT: 'neutral',
  SEALED: 'info',
  DISPATCHED: 'info',
  RECEIVED: 'warning',
  RECONCILED: 'success',
};

/**
 * The manifest list.
 *
 * A manifest is the line-haul's cargo list, and the only question a hub asks about one is "what is
 * on it and what is still missing" — so RECONCILED is filtered in by default alongside the states a
 * person can still act on. An unfiltered list of 277 seeded manifests is a scroll, not a queue.
 */
function ManifestList() {
  const [filter, setFilter] = useState<ManifestStatus | 'ALL'>('ALL');
  const manifests = useAsync(
    () => apiClient().manifests(filter === 'ALL' ? undefined : filter),
    filter,
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-5">
      <h1 className="text-xl font-semibold tracking-tight">Manifests</h1>
      <p className="mt-1 text-sm text-slate-600">
        Seal a manifest, dispatch it, receive it, reconcile it.
      </p>

      {/* Segmented filter rather than a Select: five options, and a phone operator taps twice
          instead of opening a dropdown and choosing from a list of the same five. */}
      <div className="mt-4 flex flex-wrap gap-1">
        {FILTERS.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={filter === option ? 'primary' : 'secondary'}
            onClick={() => setFilter(option)}
          >
            {option === 'ALL' ? 'All' : statusLabel(option)}
          </Button>
        ))}
      </div>

      <div className="mt-4">
        {manifests.error ? (
          <ErrorState message={manifests.error} retry={manifests.reload} />
        ) : manifests.loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (manifests.data?.data.length ?? 0) === 0 ? (
          <EmptyState
            title="No manifests"
            description="Nothing at this status. A manifest is created when a trip is scheduled."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {manifests.data?.data.map((manifest) => (
              <li key={manifest.id}>
                <Link
                  to="/manifests/$id"
                  params={{ id: manifest.id }}
                  className="flex min-h-16 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 active:bg-slate-100"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-900">
                      {manifest.code}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-slate-500">
                      Trip {manifest.tripId.slice(0, 8)}
                    </span>
                  </span>
                  <Badge tone={TONE[manifest.status]}>{statusLabel(manifest.status)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
