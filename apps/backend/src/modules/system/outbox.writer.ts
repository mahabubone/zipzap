/**
 * Writing to the outbox.
 *
 * `append` MUST be called with the EntityManager of the transaction that made the state
 * change. Passing anything else breaks ADR-0005 — the whole point is that the state change
 * and the event commit together or not at all.
 */

import type { EntityManager } from 'typeorm';

export interface DomainEvent {
  readonly type: string;
  readonly version?: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  readonly occurredAt?: Date;
}

export async function append(manager: EntityManager, event: DomainEvent): Promise<void> {
  await manager.query(
    `INSERT INTO system.outbox_events
       (event_type, event_version, aggregate_type, aggregate_id, payload, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      event.type,
      event.version ?? 1,
      event.aggregateType,
      event.aggregateId,
      JSON.stringify(event.payload),
      event.occurredAt ?? new Date(),
    ],
  );
}
