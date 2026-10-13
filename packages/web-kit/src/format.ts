/**
 * How this product says things, in one place.
 *
 * Four surfaces — merchant console, public tracking, control tower, hub console — each had their own
 * copy of this file, and they had already disagreed: `IN_TRANSIT` read "In transit" in two of them
 * and "in transit" in the others, and ৳1,250.50 was written three ways by three formatters. Two of
 * those copies carried a comment saying they were duplicates kept in sync by hand, which is a
 * promise rather than a mechanism.
 *
 * So this is the one implementation, and `format.spec.ts` asserts the decisions rather than the code:
 * a test inside each app would have kept passing while the copies drifted apart, because each one
 * was correct on its own.
 *
 * Two deliberate omissions. There is no `zoneLabel`-adjacent list of zones, because zones come from
 * the server and a hard-coded list offers a retired zone and hides a new one. And there is no
 * "current time", because every timestamp here is read in Asia/Dhaka on purpose: the network runs
 * on Dhaka time, and a work list that shifts with the reader's laptop is a work list that cannot be
 * compared with yesterday's screenshot.
 */

/** Badge tones, named by intent rather than by colour — the kit's `Badge` is the only consumer. */
export type StatusTone = 'success' | 'danger' | 'warning' | 'neutral' | 'info';

const MINOR_UNITS: Record<string, number> = { BDT: 100, USD: 100, EUR: 100 };
const SYMBOLS: Record<string, string> = { BDT: '৳', USD: '$', EUR: '€' };

/** Grouping only. The fraction is appended by hand so no division reaches a float. */
const grouping = new Intl.NumberFormat('en-BD', { maximumFractionDigits: 0 });

/** `2026-10-07T16:39:47.960Z` → `7 Oct 2026, 22:39`. Fixed locale + fixed zone. */
export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIMEZONE,
  }).format(new Date(iso));
}

/** `2026-10-07T16:39:47.960Z` → `22:39`. For a work list, where the date is noise. */
export function formatClock(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIMEZONE,
  }).format(new Date(iso));
}

/** The network's timezone. Every timestamp in the product is in it, on purpose. */
const TIMEZONE = 'Asia/Dhaka';

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

/**
 * `IN_TRANSIT` → `In transit`.
 *
 * The fallback matters more than the map. A status the backend adds ships to a human as words on the
 * day it ships; a raw enum reads as a bug on a screen somebody is looking at.
 */
export function humanStatus(status: string): string {
  const lower = status.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * The dock's vocabulary, for the two machines whose enums a person reads out loud.
 *
 * An operator does not scan "INBOUND" — they put a parcel on the inbound belt. Both vocabularies
 * land on the same screen in the hub console, which is exactly how a manifest badge once rendered
 * `received` in lowercase while the button beneath it said "Reconcile".
 */
const SCAN_LABELS: Record<string, string> = {
  INBOUND: 'Inbound',
  SORT: 'Sort',
  OUTBOUND: 'Outbound',
  DEPARTED: 'Departed',
  ARRIVED: 'Arrived',
};

/** `INBOUND` → `Inbound`. */
export function scanLabel(kind: string): string {
  return SCAN_LABELS[kind] ?? humanStatus(kind);
}

/**
 * `INBOUND` → `Scan inbound`. The button is the whole gesture, so it says so.
 *
 * An unrecognised kind produces `Scan` and nothing more. Reading the enum back to a person —
 * "Scan teleported" — invites them to try a gesture that does not exist, which is worse than a
 * button whose label is simply short. The server is the only source of kinds that reach a row, so
 * in practice this is the branch that keeps a new enum from being narrated before it is designed.
 */
export function scanAction(kind: string): string {
  const label = SCAN_LABELS[kind];
  return label ? `Scan ${label.toLowerCase()}` : 'Scan';
}

const SHIPMENT_LABELS: Record<string, string> = {
  CREATED: 'Created',
  PICKUP_REQUESTED: 'Pickup requested',
  PICKUP_ASSIGNED: 'Rider assigned',
  PICKED_UP: 'Picked up',
  AT_ORIGIN_HUB: 'At origin hub',
  SORTING: 'Sorting',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In transit',
  AT_DESTINATION_HUB: 'At destination hub',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

const MANIFEST_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SEALED: 'Sealed',
  RECEIVED: 'Received',
  RECONCILED: 'Reconciled',
};

/** The label for a shipment or manifest state, with a readable fallback. */
export function statusLabel(status: string): string {
  return SHIPMENT_LABELS[status] ?? MANIFEST_LABELS[status] ?? humanStatus(status);
}

const SUCCESS = new Set([
  'DELIVERED',
  'RETURNED',
  'COMPLETED',
  'SETTLED',
  'COD_COLLECTED',
  'AVAILABLE',
  'RECONCILED',
]);

const DANGER = new Set(['CANCELLED', 'LOST', 'DAMAGED', 'DELIVERY_FAILED', 'FAILED', 'SUSPENDED']);

const WARNING = new Set(['ON_HOLD', 'RETRY_SCHEDULED', 'EXCEPTION', 'RETURN_INITIATED']);

/** Status → badge tone. Grouped by what a person must act on, not by hue. */
export function statusTone(status: string): StatusTone {
  if (SUCCESS.has(status)) return 'success';
  if (DANGER.has(status)) return 'danger';
  if (WARNING.has(status)) return 'warning';
  if (status === 'CREATED' || status === 'DRAFT' || status === 'REQUESTED') return 'neutral';
  return 'info';
}

/** `chattogram-metro` → `Chattogram metro`. The slug is the wire format; nobody types it. */
export function zoneLabel(zone: string): string {
  const words = zone.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The API's decimal string → integer minor units. Exact because the value is an integer: `Number`
 * is precise below 2^53 and nothing here exceeds it.
 */
export function minorOf(decimalString: string): number {
  return Number(decimalString);
}

/**
 * `125050` + `BDT` → `৳1,250.50`, and `-50` → `-৳0.50`.
 *
 * A string, for the places that need money inside prose: a timeline detail line, a CSV cell, a
 * table of contents. Anything that renders a figure on its own should use `MoneyText` from the kit,
 * which draws the same digits through this function.
 *
 * The split happens in integer space. `amountMinor / 100` is a float, and the nearest double to the
 * largest safe integer is one hundredth of a minor unit short of it — so it renders `…409.90` for an
 * amount that is `…409.91`. The backend's `money.format()` splits the same way, so a statement and a
 * screen cannot disagree by a poisha. See docs/ADR/0009.
 *
 * The sign goes outside the symbol. `Intl` puts it on the number, so prefixing naively yields
 * `৳-0.50`, which reads as a corrupted taka sign followed by a stray dash — and it is the format of
 * every correction row on every statement.
 */
export function formatMinor(amountMinor: number, currency: string): string {
  const scale = MINOR_UNITS[currency] ?? 100;
  const decimals = String(scale).length - 1;
  const sign = amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(amountMinor);
  const major = grouping.format(Math.trunc(absolute / scale));
  const minor = (absolute % scale).toString().padStart(decimals, '0');
  const symbol = SYMBOLS[currency] ?? '';
  return `${sign}${symbol}${major}.${minor}`;
}
