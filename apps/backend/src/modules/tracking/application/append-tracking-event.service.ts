/**
 * Appends to the tracking log inside the caller's transaction.
 *
 * `manager` is required, not optional. The tracking log is the authoritative history of a
 * shipment's movement, so it is written in the same transaction as the state change that caused
 * it — strongly consistent, not eventually consistent. The public timeline is the part that is
 * eventually consistent, and it is built by the consumer.
 */

import type { EntityManager } from 'typeorm';
import type { AppendTrackingEvent } from '../domain/tracking-event.ts';

export class AppendTrackingEventService {
  append(manager: EntityManager, event: AppendTrackingEvent): Promise<void> {
    return manager
      .query(
        `INSERT INTO tracking.events
         (id, shipment_id, event_type, occurred_at, actor_type, actor_id, metadata, corrects_event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          event.id,
          event.shipmentId,
          event.eventType,
          event.occurredAt ?? new Date(),
          event.actorType,
          event.actorId ?? null,
          JSON.stringify(event.metadata ?? {}),
          event.correctsEventId ?? null,
        ],
      )
      .then(() => undefined);
  }
}
