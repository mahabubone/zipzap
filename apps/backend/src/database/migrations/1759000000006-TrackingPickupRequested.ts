/**
 * Adds PICKUP_REQUESTED to tracking.event_type.
 *
 * The enum shipped without it — the vocabulary jumped from SHIPMENT_CREATED to PICKUP_ASSIGNED,
 * skipping the event the pickup service had to emit. ALTER TYPE ... ADD VALUE is additive and
 * online-safe; Postgres enum values are never removed (a rollback that destroyed values in
 * historical rows would corrupt the log it is meant to protect).
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackingPickupRequested1759000000006 implements MigrationInterface {
  name = 'TrackingPickupRequested1759000000006';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TYPE tracking.event_type ADD VALUE IF NOT EXISTS 'PICKUP_REQUESTED'`);
  }

  public async down(): Promise<void> {
    // Intentionally a no-op: enum values are append-only. Dropping a value that historical
    // tracking rows may reference would corrupt the log.
  }
}
