/**
 * The outbox publisher. The only process permitted to publish to NATS (ADR-0005).
 *
 * Drains `system.outbox_events` with `FOR UPDATE SKIP LOCKED`, so several replicas can run
 * without blocking each other and a crash loses nothing — an unpublished row is simply
 * picked up again.
 */

import type { JetStreamClient, NatsConnection } from 'nats';
import type { DataSource, EntityManager } from 'typeorm';
import { Logger } from '@nestjs/common';
import { incEventPublished, outboxPublishDuration, outboxPublishTotal } from '../../common/metrics';

const BATCH_SIZE = 100;
const POLL_INTERVAL_MS = 1_000;

export interface OutboxRow {
  readonly id: string;
  readonly event_type: string;
  readonly event_version: number;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly payload: unknown;
  readonly occurred_at: Date;
}

/**
 * `zipzap.<aggregate>.<fact>` — e.g. aggregate `shipment` + event `ShipmentDelivered`
 * becomes `zipzap.shipment.delivered`, not `zipzap.shipment.shipment_delivered`.
 *
 * The aggregate name is stripped because every event is named `<Aggregate><PastTenseVerb>`.
 * The match is case-insensitive so acronyms work (`cod` + `CODCollected` → `cod.collected`),
 * and requires a word boundary so `cod` does not match `CodeDelivered`. When the convention
 * is not met at all, the whole event name is used: redundant but routable beats broken.
 */
export function subjectFor(row: Pick<OutboxRow, 'aggregate_type' | 'event_type'>): string {
  const aggregate = row.aggregate_type;
  const event = row.event_type;
  const prefix = aggregate.toLowerCase();
  const candidate = event.toLowerCase();
  const boundaryFollows = /[A-Z]/.test(event[aggregate.length] ?? '');

  const fact =
    candidate.startsWith(prefix) && boundaryFollows ? event.slice(aggregate.length) : event;

  return `zipzap.${aggregate}.${snake(fact)}`;
}

function snake(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly nc: NatsConnection,
    private readonly js: JetStreamClient,
  ) {}

  /** Publish a single row with timing and outcome instrumentation. */
  private async publishOne(row: OutboxRow): Promise<void> {
    const start = Date.now();
    const subject = subjectFor(row);
    try {
      await this.js.publish(
        subject,
        JSON.stringify({
          id: String(row.id),
          type: row.event_type,
          version: row.event_version,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          occurredAt: new Date(row.occurred_at as unknown as string).toISOString(),
          data: row.payload,
        }),
      );
      outboxPublishTotal.labels({ outcome: 'published' }).inc();
      outboxPublishDuration.labels({ outcome: 'published' }).observe((Date.now() - start) / 1000);
      incEventPublished(subject);
    } catch (error) {
      outboxPublishTotal.labels({ outcome: 'failed' }).inc();
      outboxPublishDuration.labels({ outcome: 'failed' }).observe((Date.now() - start) / 1000);
      throw error;
    }
  }

  /**
   * Publish one batch. The transaction is held across the publishes on purpose: releasing
   * the lock first would let a second publisher send the same event, and holding it means a
   * publish failure rolls the whole batch back for an honest retry.
   */
  async publishBatch(): Promise<number> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const rows: OutboxRow[] = await manager.query(
        `SELECT id, event_type, event_version, aggregate_type, aggregate_id, payload, occurred_at
           FROM system.outbox_events
          WHERE published_at IS NULL
          ORDER BY id
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [BATCH_SIZE],
      );
      if (rows.length === 0) return 0;

      for (const row of rows) {
        try {
          await this.publishOne(row);
        } catch (error) {
          await manager.query(
            `UPDATE system.outbox_events
                SET attempts = attempts + 1, last_error = $2
              WHERE id = $1`,
            [row.id, error instanceof Error ? error.message : String(error)],
          );
          throw error;
        }
      }

      await manager.query(
        `UPDATE system.outbox_events
            SET published_at = now()
          WHERE id = ANY($1::bigint[])`,
        [rows.map((row) => row.id)],
      );
      return rows.length;
    });
  }

  start(): void {
    const tick = async (): Promise<void> => {
      if (this.stopped) return;
      try {
        let drained = 0;
        do {
          drained = await this.publishBatch();
        } while (drained === BATCH_SIZE && !this.stopped);
      } catch (error) {
        this.logger.error({ err: error }, 'outbox drain failed; will retry');
      }
    };
    this.timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  get connection(): NatsConnection {
    return this.nc;
  }
}
