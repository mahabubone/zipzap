import type { HubScanKind } from '@zipzap/api-client';

/**
 * The five physical gestures, in the words the person at the belt uses.
 *
 * An operator does not scan "INBOUND" — they put a parcel on the inbound belt.
 * `INBOUND` reaching the screen is a bug, and it was one: the Stage 2 proof caught the raw enum
 * rendering in a table cell. Every kind is listed here explicitly rather than derived by
 * `toLowerCase`, so adding a sixth kind to the backend fails the verify script instead of shipping
 * a raw enum to a loading dock.
 */
export const SCAN_LABELS: Record<HubScanKind, string> = {
  INBOUND: 'Inbound',
  SORT: 'Sort',
  OUTBOUND: 'Outbound',
  DEPARTED: 'Departed',
  ARRIVED: 'Arrived',
};

/** `INBOUND` → `Scan inbound`. The button is the whole gesture, so it says so. */
export function scanAction(kind: string): string {
  const label = SCAN_LABELS[kind as HubScanKind];
  return label ? `Scan ${label.toLowerCase()}` : 'Scan';
}

/**
 * The machine's states, in the same spirit. A parcel's status is read as often as its scan is.
 *
 * Two vocabularies land here — the shipment machine's and the manifest machine's — because they are
 * read side by side on the same screen. Leaving the manifest's out is not a neutral omission: the
 * fallback lowercases, so a manifest badge read `received` in lowercase while the button beneath it
 * said `Reconcile`. Found by the browser proof, not by reading this.
 */
const STATUS_LABELS: Record<string, string> = {
  // Shipment.
  CREATED: 'Created',
  PICKED_UP: 'Picked up',
  AT_ORIGIN_HUB: 'At origin hub',
  SORTING: 'Sorting',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In transit',
  AT_DESTINATION_HUB: 'At destination hub',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  // Manifest.
  DRAFT: 'Draft',
  SEALED: 'Sealed',
  RECEIVED: 'Received',
  RECONCILED: 'Reconciled',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, ' ').toLowerCase();
}

/** `2026-10-07T16:39:47.960Z` → `22:39`. Fixed locale + fixed zone so a screenshot taken today
 *  still reads correctly tomorrow. Day and month are noise on a work list — a hub operator cares
 *  whether a parcel arrived four minutes ago or four hours ago. */
export function formatClock(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dhaka',
  }).format(new Date(iso));
}

/** `4 min ago`, `3 h ago`, `2 d ago`. A loading dock does not want a date picker. */
export function formatAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
