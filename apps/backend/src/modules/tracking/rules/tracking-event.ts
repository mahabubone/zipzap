/**
 * Tracking events. Framework-free.
 *
 * An event is an immutable statement that something happened. Corrections are NEW events that
 * reference the original — never an UPDATE, because history that can be rewritten cannot answer
 * "what happened", and that is the only reason to keep a log.
 */

export const TRACKING_EVENT_TYPES = [
  'SHIPMENT_CREATED',
  'PICKUP_REQUESTED',
  'PICKUP_ASSIGNED',
  'PICKED_UP',
  'ARRIVED_AT_HUB',
  'SORTED',
  'DISPATCHED',
  'ARRIVED_AT_DESTINATION_HUB',
  'OUT_FOR_DELIVERY',
  'DELIVERY_ATTEMPTED',
  'COD_COLLECTED',
  'DELIVERED',
  'SHIPMENT_CANCELLED',
  'RETURN_INITIATED',
  'RETURNED',
  // Operational exceptions (lost, damaged) — announced on the public timeline:
  // a parcel that vanishes from the tracking page is a lie by omission.
  'EXCEPTION_RAISED',
  'EVENT_CORRECTED',
  // Merchant pause/resume gestures — a held parcel must appear on tracking,
  // or the customer sees a silent gap.
  'SHIPMENT_HELD',
  'SHIPMENT_RELEASED',
] as const;

export type TrackingEventType = (typeof TRACKING_EVENT_TYPES)[number];

export interface TrackingEvent {
  readonly id: string;
  readonly shipmentId: string;
  readonly eventType: TrackingEventType;
  readonly occurredAt: Date;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly metadata: Record<string, unknown>;
  /** Set only on EVENT_CORRECTED. */
  readonly correctsEventId: string | null;
}

export interface AppendTrackingEvent {
  readonly id: string;
  readonly shipmentId: string;
  readonly eventType: TrackingEventType;
  readonly occurredAt?: Date;
  readonly actorType: string;
  readonly actorId?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly correctsEventId?: string | null;
}
