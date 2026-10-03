/**
 * Tracking events. Framework-free.
 *
 * An event is an immutable statement that something happened. Corrections are NEW events that
 * reference the original — never an UPDATE, because history that can be rewritten cannot answer
 * "what happened", and that is the only reason to keep a log.
 */

export const TRACKING_EVENT_TYPES = [
  'SHIPMENT_CREATED',
  'PICKUP_ASSIGNED',
  'PICKED_UP',
  'ARRIVED_AT_HUB',
  'SORTED',
  'DISPATCHED',
  'ARRIVED_AT_DESTINATION_HUB',
  'OUT_FOR_DELIVERY',
  'DELIVERY_ATTEMPTED',
  'DELIVERED',
  'RETURN_INITIATED',
  'RETURNED',
  'EVENT_CORRECTED',
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
