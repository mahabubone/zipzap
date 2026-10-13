/**
 * What a status is called, in this product, everywhere.
 *
 * ## Why the words are shared and the colours are not
 *
 * The rider app and the web consoles asked the same questions and answered them separately, and the
 * answers drifted on the same screen: a delivery in `OUT_FOR_DELIVERY` rendered **brand** on the home
 * preview, **neutral** on the jobs list and **brand** on the detail — three decisions from one enum, in
 * one app. Meanwhile every label on the rider read `out for delivery`, lowercased off the wire format,
 * and two of those screens announced the raw enum to VoiceOver.
 *
 * Colour is genuinely per-surface: the rider app needs `brand` because it is holding the phone, and
 * the merchant console does not. So this file owns the **wording** — which is a product decision and
 * cannot be right twice — and `state.ts` owns the **meaning**, which each kit then paints its own way.
 */

/**
 * `IN_TRANSIT` → `In transit`, for a status with no better name.
 *
 * The fallback matters more than the map. A status the backend adds ships to a human as words on the
 * day it ships; a raw enum reads as a bug on a screen somebody is looking at — which is exactly what
 * the rider app was doing with `status.replace(/_/g, ' ')`.
 */
export function humanStatus(status: string): string {
  const lower = status.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * The dock's vocabulary, for the two machines whose enums a person reads out loud.
 *
 * An operator does not scan "INBOUND" — they put a parcel on the inbound belt.
 */
const SCAN_LABELS: Readonly<Record<string, string>> = {
  INBOUND: 'Inbound',
  SORT: 'Sort',
  OUTBOUND: 'Outbound',
  DEPARTED: 'Departed',
  ARRIVED: 'Arrived',
};

export function scanLabel(kind: string): string {
  return SCAN_LABELS[kind] ?? humanStatus(kind);
}

/**
 * `INBOUND` → `Scan inbound`. The button is the whole gesture, so it says so.
 *
 * An unrecognised kind produces `Scan` and nothing more. Reading the enum back to a person — "Scan
 * teleported" — invites them to try a gesture that does not exist, which is worse than a button whose
 * label is simply short.
 */
export function scanAction(kind: string): string {
  const label = SCAN_LABELS[kind];
  return label ? `Scan ${label.toLowerCase()}` : 'Scan';
}

/** The states a merchant reads on a shipment, where the enum's own word is the right word. */
const SHIPMENT_LABELS: Readonly<Record<string, string>> = {
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
  LOST: 'Lost',
  DAMAGED: 'Damaged',
  ON_HOLD: 'On hold',
  RETURNED: 'Returned',
  RETURN_INITIATED: 'Return initiated',
  DELIVERY_FAILED: 'Delivery failed',
};

/** The states a manifest passes through, which share a screen with shipments in the hub console. */
const MANIFEST_LABELS: Readonly<Record<string, string>> = {
  DRAFT: 'Draft',
  SEALED: 'Sealed',
  RECEIVED: 'Received',
  RECONCILED: 'Reconciled',
};

/**
 * The label for a shipment or manifest state, with a readable fallback.
 *
 * A rider sees job states the merchant never sees — `ASSIGNED`, `ON_PICKUP`, `ON_DELIVERY` — and they
 * all fall through to `humanStatus`, which is the correct word for them. The map is for the states
 * where the enum's word is technically right but reads like a machine.
 */
export function statusLabel(status: string): string {
  return SHIPMENT_LABELS[status] ?? MANIFEST_LABELS[status] ?? humanStatus(status);
}

/** `chattogram-metro` → `Chattogram metro`. The slug is the wire format; nobody types it. */
export function zoneLabel(zone: string): string {
  const words = zone.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
