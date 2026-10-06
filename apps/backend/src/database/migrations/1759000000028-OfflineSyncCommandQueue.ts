/**
 * Offline rider mode — server command queue (Phase 5 rung 4).
 *
 * A rider that goes offline queues mutating commands locally. On reconnection the server
 * replays them in `created_at` order (`device_sequence` is the rider device's monotonic
 * clock, unique per rider). Each command carries `expected_state` — the aggregate snapshot
 * at enqueue time. During ack the server compares it with current state: a mismatch is a
 * **recorded rejection with a reason**, never a silent drop. A command that is already acked
 * is replayed byte-for-byte. Pending commands are pulled in a capped window (`RIDER_COMMAND_QUEUE_CAP`,
 * default 100) with a 90% warning.
 *
 * Delivery/rejection is append-only: `acknowledged_at` or `rejected_at` (never both) plus
 * the reason — history is never rewritten. Delivery or rejection is derived from those two
 * columns: a row with neither set is `PENDING`. The pending-window index keeps pulls cheap.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class OfflineSyncCommandQueue1759000000028 implements MigrationInterface {
  name = 'OfflineSyncCommandQueue1759000000028';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE IF NOT EXISTS rider.command_queue (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        rider_id          uuid        NOT NULL REFERENCES rider.riders(id) ON DELETE CASCADE,
        device_sequence   bigint      NOT NULL,
        command_type      text        NOT NULL,
        payload           jsonb       NOT NULL DEFAULT '{}',
        expected_state    jsonb,
        created_at        timestamptz NOT NULL DEFAULT now(),
        acknowledged_at   timestamptz,
        rejected_at       timestamptz,
        rejection_reason  text
      )
    `);

    await r.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS command_queue_rider_device_sequence_uq
      ON rider.command_queue (rider_id, device_sequence)
    `);

    await r.query(`
      CREATE INDEX IF NOT EXISTS command_queue_pending_by_order
      ON rider.command_queue (rider_id, created_at ASC, device_sequence ASC)
      WHERE acknowledged_at IS NULL AND rejected_at IS NULL
    `);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS rider.command_queue`);
  }
}
