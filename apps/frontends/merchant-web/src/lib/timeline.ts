/**
 * Turning the merchant timeline log into lines a human reads.
 *
 * Framework-free and pure, so `verify-timeline.mjs` can assert it without a browser —
 * same convention as `bulk.ts` and `actions.ts`.
 *
 * The metadata bag is whatever the writer put in it, and the writers are spread across six
 * modules (`hub-scan`, `record-attempt`, `collect-cod`, `hold-release`, …). So the shape is
 * genuinely open. Two consequences, both deliberate:
 *
 *   - every field is read defensively. A metadata key the UI does not recognise is dropped,
 *     never printed as `[object Object]`.
 *   - an event with no recognised metadata still renders, with its type as the label. A log
 *     entry silently disappearing is worse than one that says less.
 *
 * `ponytail:` the per-type label map is hand-written rather than derived from the snake-case
 * type, because `ARRIVED_AT_DESTINATION_HUB` derived is "Arrived at destination hub" — correct,
 * but `SHIPMENT_HELD` derived is "Shipment held" where "On hold" is what a merchant reads.
 * Add a row when the tracking vocabulary gains a type; verify-timeline.mjs fails if one is
 * missing, so drift cannot be silent.
 */

import type { TimelineEntry } from '@zipzap/api-client';
import { formatMinor, humanStatus } from '@zipzap/web-kit';

export interface TimelineLine {
  /** The event's own id — never the index. Two corrections can share an instant. */
  readonly key: string;
  readonly label: string;
  /** Metadata worth a merchant's attention, joined with ` · `. Empty when there is none. */
  readonly detail: string;
  readonly occurredAt: string;
  readonly actorType: string;
  /** True when this row IS a correction, so the screen can mark it. Rule 8: a
   *  correction never edits, it is shown as its own line rather than as a replacement. */
  readonly corrects: boolean;
}

/** Merchant-facing wording. Copied from TRACKING_EVENT_TYPES in the tracking module. */
const LABELS: Readonly<Record<string, string>> = {
  SHIPMENT_CREATED: 'Shipment created',
  PICKUP_REQUESTED: 'Pickup requested',
  PICKUP_ASSIGNED: 'Rider assigned',
  PICKED_UP: 'Picked up',
  ARRIVED_AT_HUB: 'Arrived at hub',
  SORTED: 'Sorted at hub',
  DISPATCHED: 'Left the hub',
  ARRIVED_AT_DESTINATION_HUB: 'Arrived at destination hub',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERY_ATTEMPTED: 'Delivery attempted',
  COD_COLLECTED: 'Cash collected',
  DELIVERED: 'Delivered',
  SHIPMENT_CANCELLED: 'Shipment cancelled',
  RETURN_INITIATED: 'Return started',
  RETURNED: 'Returned',
  EXCEPTION_RAISED: 'Problem reported',
  EVENT_CORRECTED: 'Earlier entry corrected',
  SHIPMENT_HELD: 'On hold',
  SHIPMENT_RELEASED: 'Released',
};

export function eventLabel(eventType: string): string {
  const known = LABELS[eventType];
  if (known) return known;
  // Unknown vocabulary must still read as a sentence, never as a raw enum.
  return humanStatus(eventType);
}

/** A metadata value, if it is a printable scalar. Objects, arrays, nullish, NaN and
 *  Infinity are all unread — the writers never put them in a key this file reads. */
function scalar(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function str(metadata: Readonly<Record<string, unknown>>, key: string): string | null {
  return scalar(metadata[key]);
}

function money(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
  currency: string,
): string | null {
  const value = metadata[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return formatMinor(value, currency);
}

/**
 * Only keys named below are read. `jobId`, `pickupId`, `batchSize` and friends are in the
 * same bag and stay unread: a merchant does not have a job id, and a screen that renders
 * the whole bag is a screen nobody reads.
 *
 * `expected / collected / shortfall` is the one part of the log a merchant disputes over,
 * so it gets the most detail. Everything else is a short clause.
 */
function detailFor(entry: TimelineEntry, currency: string): string {
  const m = entry.metadata;
  const parts: string[] = [];

  if (entry.eventType === 'COD_COLLECTED') {
    const expected = money(m, 'expectedMinor', currency);
    const collected = money(m, 'collectedMinor', currency);
    if (expected) parts.push(`expected ${expected}`);
    if (collected) parts.push(`collected ${collected}`);

    // `shortfallMinor` is `expected - collected`, so NEGATIVE means the rider took too much.
    // `reconcile()` in the cod rules calls that a MISMATCH, not a bonus: "over-collection is
    // as wrong as under-collection, and both must surface". Showing only a positive gap
    // would hide the one case where a merchant's rider pocketed extra cash. Zero says nothing.
    const gap = m.shortfallMinor;
    if (typeof gap === 'number' && gap !== 0) {
      const magnitude = formatMinor(Math.abs(gap), currency);
      parts.push(gap > 0 ? `${magnitude} short` : `${magnitude} over-collected`);
    }
  } else {
    const hubCode = str(m, 'hubCode');
    const scan = str(m, 'scan');
    if (hubCode) parts.push(`hub ${hubCode}`);
    if (scan) parts.push(scan);

    const reason = str(m, 'reason');
    if (reason) parts.push(reason);
    const note = str(m, 'note');
    if (note && note !== reason) parts.push(note);

    const resumeFrom = str(m, 'resumeFrom');
    if (resumeFrom) parts.push(`paused from ${humanStatus(resumeFrom)}`);
    const resumedTo = str(m, 'resumedTo');
    if (resumedTo) parts.push(`resumed to ${humanStatus(resumedTo)}`);

    // The attempt number before the outcome: "attempt 2 · retry scheduled" reads as
    // cause then effect, and the label above already says which attempt this is.
    if (entry.eventType === 'DELIVERY_ATTEMPTED') {
      const sequence = m.sequence;
      if (typeof sequence === 'number') parts.push(`attempt ${sequence}`);
    }
    if (m.retryScheduled === true) parts.push('retry scheduled');
  }

  return parts.join(' · ');
}

export function timelineLines(
  entries: ReadonlyArray<TimelineEntry>,
  currency: string,
): ReadonlyArray<TimelineLine> {
  return entries.map((entry, index) => ({
    key: `${entry.occurredAt}#${entry.eventType}#${index}`,
    label: eventLabel(entry.eventType),
    detail: detailFor(entry, currency),
    occurredAt: entry.occurredAt,
    actorType: entry.actorType,
    // Either signal counts. `reconcile-cod.service.ts` writes EVENT_CORRECTED with a null
    // `corrects_event_id` — the review note is the whole point and there is no single row
    // it supersedes. Keying the badge on the id alone would leave those uncorrected-looking.
    corrects: entry.eventType === 'EVENT_CORRECTED' || entry.correctsEventId !== null,
  }));
}
