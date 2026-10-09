import { useState } from 'react';
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { ZipZapApiError, type ManifestEdge, type ManifestStatus } from '@zipzap/api-client';
import { Badge, Button, ErrorState, Spinner } from '@zipzap/ui';
import { apiClient } from '../lib/api.ts';
import { useAsync } from '../lib/useAsync.ts';
import { statusLabel } from '../lib/scans.ts';

export const Route = createFileRoute('/manifests/$id')({
  component: ManifestDetailScreen,
});

/**
 * Which edge is legal from each status, and what the button says.
 *
 * Keyed by the *current* status rather than shipped as a flat list of four. The server decides
 * legality — this only decides what to *offer*, and offering a button that 409s would teach the
 * operator that this screen lies. RECONCILED has no button because it is the end of the road, and
 * an empty state where a button should be is a worse lie than no button.
 */
const EDGES: Record<
  ManifestStatus,
  { readonly edge: ManifestEdge; readonly label: string } | null
> = {
  DRAFT: { edge: 'seal', label: 'Seal manifest' },
  SEALED: { edge: 'dispatch', label: 'Dispatch' },
  DISPATCHED: { edge: 'receive', label: 'Receive' },
  RECEIVED: { edge: 'reconcile', label: 'Reconcile' },
  RECONCILED: null,
};

function ManifestDetailScreen() {
  const { id } = useParams({ from: '/manifests/$id' });
  const manifest = useAsync(() => apiClient().manifest(id), id);

  const [refusal, setRefusal] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [arriving, setArriving] = useState<string | null>(null);

  async function advance() {
    const edge = manifest.data ? EDGES[manifest.data.status] : null;
    if (!edge) return;
    setBusy(true);
    setRefusal(null);
    setDone(null);
    try {
      await apiClient().manifestTransition(id, edge.edge);
      setDone(`${edge.label} recorded`);
      // Status moved, so `missingCount` and the legal edge are both stale. Refetch.
      manifest.reload();
    } catch (e) {
      setRefusal(
        e instanceof ZipZapApiError
          ? e.envelope.detail
          : e instanceof Error
            ? e.message
            : 'That did not work.',
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Record one parcel's arrival at the destination hub.
   *
   * This gesture has no button on the hub work list, and that is not an oversight — see the note on
   * the cargo rows. So it lives here, where the manifest names the parcels that are supposed to have
   * arrived. `hubCode` is omitted on purpose: this screen does not know which building the manifest
   * was received at, and the scan service treats an absent hub as "we were not told" rather than
   * guessing one. The arrival is recorded; where it happened is the manifest's business.
   */
  async function arrive(shipmentId: string) {
    setArriving(shipmentId);
    setRefusal(null);
    setDone(null);
    try {
      await apiClient().scan({ shipmentId, scan: 'ARRIVED' });
      manifest.reload();
    } catch (e) {
      setRefusal(
        e instanceof ZipZapApiError
          ? e.envelope.detail
          : e instanceof Error
            ? e.message
            : 'Arrival failed.',
      );
    } finally {
      setArriving(null);
    }
  }

  if (manifest.error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-5">
        <ErrorState message={manifest.error} retry={manifest.reload} />
      </main>
    );
  }
  if (manifest.loading || !manifest.data) {
    return (
      <main className="mx-auto flex justify-center px-4 py-10">
        <Spinner />
      </main>
    );
  }

  // Hoisted so every read below is the same narrowed value; TS does not narrow `manifest.data`
  // inside a `.map` callback, and re-asserting it in each row would be noise.
  const data = manifest.data;
  const edge = EDGES[data.status];
  const missing = data.items.filter((item) => !item.arrived);

  return (
    <main className="mx-auto max-w-3xl px-4 py-5">
      <Link to="/manifests" className="text-sm text-slate-500 hover:text-slate-800">
        ← Manifests
      </Link>
      <div className="mt-1 flex items-center justify-between gap-3">
        <h1 className="truncate text-xl font-semibold tracking-tight">{data.code}</h1>
        <Badge tone={data.status === 'RECONCILED' ? 'success' : 'info'}>
          {statusLabel(data.status)}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-slate-600">Trip {data.tripId.slice(0, 8)}</p>

      {refusal ? (
        <div role="alert" className="mt-4 rounded-lg border-2 border-red-300 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-900">Refused</p>
          <p className="mt-1 text-slate-800">{refusal}</p>
          <Button variant="ghost" size="sm" className="mt-2 -ml-3" onClick={() => setRefusal(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {done ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          {done}
        </p>
      ) : null}

      {/* The exception, as a queue and not a log line — exit check three.
          It says "not arrived", never "missing", and the difference is the whole point: a manifest
          knows what was on the truck and what has been checked in. It cannot know a parcel was lost
          in a depot, and a screen that says "missing" is making a claim its data does not support.
          Before RECEIVED nobody has looked at all, so the banner stays hidden rather than claiming
          good news it has not verified. */}
      {data.status === 'RECEIVED' && missing.length > 0 ? (
        <div className="mt-4 rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-3">
          <p className="font-semibold text-amber-900">
            {missing.length} of {data.itemCount} parcels have not arrived
          </p>
          <p className="mt-1 text-sm text-amber-800">
            This manifest cannot be reconciled until every parcel has arrived.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {missing.map((item) => (
              <li key={item.shipmentId} className="font-mono text-sm text-slate-700">
                {item.shipmentId.slice(0, 8)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-5 text-sm font-medium text-slate-700">
        {data.itemCount} parcels on this manifest
      </p>
      {/* The arrival gesture lives here and nowhere else, because the hub work list structurally
          cannot offer it: DEPARTED removes a parcel from `hub.parcel_presence`, so a parcel that has
          left the origin hub is on no hub's work list, and the screen that *can* see it is the one
          holding the cargo list it was supposed to arrive on. */}
      <ul className="mt-2 flex flex-col gap-1">
        {data.items.map((item) => (
          <li
            key={item.shipmentId}
            className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2"
          >
            <span className="font-mono text-sm">{item.shipmentId.slice(0, 8)}</span>
            {item.arrived ? (
              <Badge tone="success">Arrived</Badge>
            ) : data.status === 'RECEIVED' ? (
              <Button
                size="sm"
                disabled={arriving === item.shipmentId}
                onClick={() => arrive(item.shipmentId)}
              >
                {arriving === item.shipmentId ? <Spinner /> : 'Record arrival'}
              </Button>
            ) : (
              // Before RECEIVED nobody has looked, so this is an expectation, not a failure. A
              // warning badge here would flag all 277 seeded manifests as broken.
              <Badge tone="neutral">Expected</Badge>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-6">
        {edge ? (
          <Button className="h-14 w-full text-base" disabled={busy} onClick={advance}>
            {busy ? <Spinner /> : edge.label}
          </Button>
        ) : (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Reconciled. Every parcel on this manifest arrived.
          </p>
        )}
      </div>
    </main>
  );
}
