import { useState } from 'react';
import { createFileRoute, useParams } from '@tanstack/react-router';
import { ZipZapApiError, type HubScanKind, type ParcelPresence } from '@zipzap/api-client';
import { Badge, Button, EmptyState, ErrorState, Spinner } from '@zipzap/ui';
import { apiClient } from '../../lib/api.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { formatAgo, formatClock, scanAction, statusLabel } from '../../lib/scans.ts';

/**
 * The work list, and the only screen in this app that matters.
 *
 * Every parcel here is waiting at this hub and shows the one gesture it needs next, as a button
 * sized for a gloved thumb on a 5" phone. The scan is the product; everything else is a way of
 * finding out what to scan.
 *
 * ## Why the next scan is a button and not a picker
 *
 * The obvious design is a dropdown of the five kinds per parcel, and it is wrong twice. It is
 * slower — the operator already knows the gesture, they just performed it. And it is *less* safe:
 * a picker invites choosing `OUTBOUND` on a parcel that has not been sorted, and the machine then
 * refuses with a 409 the operator has to read. Making the server's own answer the only offered
 * gesture means an out-of-order scan cannot be expressed through this screen at all — which is the
 * point of exit check one, not a workaround around it. An out-of-order scan is still reachable by
 * scanning the wrong *parcel*, and that 409 is rendered in full below.
 */
function WorkPage() {
  const { hubCode } = useParams({ from: '/hubs/$hubCode/work' });
  const work = useAsync(() => apiClient().hubParcels(hubCode), hubCode);

  // One refusal at a time, at the top, in full. A 409 from the machine names both states — "Cannot
  // move from PICKED_UP to AT_DESTINATION_HUB" — and that sentence is the entire diagnosis, so it
  // is rendered verbatim rather than paraphrased into something the operator cannot act on.
  const [refusal, setRefusal] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function scan(parcel: ParcelPresence) {
    if (!parcel.nextScan) return;
    setBusy(parcel.shipmentId);
    setRefusal(null);
    setConfirmed(null);
    try {
      const result = await apiClient().scan({
        shipmentId: parcel.shipmentId,
        // The work list already narrowed this to the server's own answer, so the one cast here is
        // from "whatever the hub table said" to the union the scan endpoint accepts. A kind the
        // hub table invents cannot reach it — the endpoint validates against its own enum.
        scan: parcel.nextScan as HubScanKind,
        hubCode,
      });
      setConfirmed(`${parcel.trackingCode} — ${scanAction(result.scan)} recorded`);
      // The work list is now wrong: this parcel's next gesture moved, and a DEPARTED parcel is
      // gone from the hub entirely. Refetch rather than patch the row — the server owns the order.
      work.reload();
    } catch (e) {
      setRefusal(
        e instanceof ZipZapApiError
          ? e.envelope.detail
          : e instanceof Error
            ? e.message
            : 'Scan failed.',
      );
    } finally {
      setBusy(null);
    }
  }

  const parcels = work.data?.parcels ?? [];

  return (
    <div className="px-6 py-5">
      {/* The refusal is the reason this app exists on a phone. It goes above the list, in full,
            in the machine's words, and it does not vanish on its own — an operator who missed it
            must still be able to read why the scan did not stick. */}
      {refusal ? (
        <div role="alert" className="mb-4 rounded-lg border-2 border-red-300 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-900">Scan refused</p>
          <p className="mt-1 text-slate-800">{refusal}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 -ml-3"
            onClick={() => setRefusal(null)}
          >
            Dismiss
          </Button>
        </div>
      ) : null}

      {confirmed ? (
        <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          {confirmed}
        </p>
      ) : null}

      {work.error ? (
        <ErrorState message={work.error} retry={work.reload} />
      ) : work.loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : parcels.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="No parcel has been scanned into this hub. Scan one in from the inbound belt."
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-600">
            {parcels.length} parcels waiting at {work.data?.hub.code}
          </p>
          <ul className="flex flex-col gap-2">
            {parcels.map((parcel) => (
              <li
                key={parcel.shipmentId}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{parcel.trackingCode}</p>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {statusLabel(parcel.lastScan)} · {formatAgo(parcel.scannedAt)} at{' '}
                    {formatClock(parcel.scannedAt)}
                  </p>
                </div>
                {parcel.nextScan ? (
                  <Button
                    className="h-14 shrink-0 px-5 text-base"
                    disabled={busy === parcel.shipmentId}
                    onClick={() => scan(parcel)}
                  >
                    {busy === parcel.shipmentId ? <Spinner /> : scanAction(parcel.nextScan)}
                  </Button>
                ) : (
                  // No further hub gesture. The parcel is AT_DESTINATION_HUB and the rest of its
                  // life is last-mile, which is not this screen's business.
                  <Badge tone="success">Done</Badge>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/hubs/$hubCode/work')({
  component: WorkPage,
});
