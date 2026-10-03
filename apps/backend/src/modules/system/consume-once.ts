/**
 * At-least-once delivery means every consumer must be idempotent, and the dedupe has to be
 * atomic with the work.
 *
 * The naive shape — insert the dedupe row, then process — loses work: if processing throws, the
 * dedupe row survives and the event is never retried. Inserting first and deleting on failure is
 * worse under concurrency.
 *
 * So the claim and the work share one transaction. If the work fails, the claim rolls back with
 * it and the message is redelivered; if it succeeds, the claim commits and a redelivery is a
 * no-op. That is the whole correctness argument for at-least-once.
 */

import type { DataSource } from 'typeorm';

export type ConsumeOutcome = 'processed' | 'duplicate';

export async function consumeOnce(
  dataSource: DataSource,
  consumer: string,
  eventId: string,
  work: (manager: import('typeorm').EntityManager) => Promise<void>,
): Promise<ConsumeOutcome> {
  return dataSource.transaction(async (manager) => {
    // ON CONFLICT DO NOTHING: two concurrent deliveries of the same event, one wins.
    const claimed = await manager.query(
      `INSERT INTO system.consumed_events (consumer, event_id)
       VALUES ($1, $2)
       ON CONFLICT (consumer, event_id) DO NOTHING
       RETURNING event_id`,
      [consumer, eventId],
    );

    if (claimed.length === 0) return 'duplicate';

    await work(manager);
    return 'processed';
  });
}
