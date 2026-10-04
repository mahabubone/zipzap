/**
 * Adds COD_COLLECTED to tracking.event_type.
 *
 * Same pattern as 0006 (PICKUP_REQUESTED): the enum shipped without the value the COD collect
 * service had to emit. ALTER TYPE ... ADD VALUE is additive and online-safe; enum values are
 * never removed, because a rollback that destroys a value in historical rows would corrupt the
 * movement log it is meant to protect.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackingCodCollected1759000000011 implements MigrationInterface {
  name = 'TrackingCodCollected1759000000011';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TYPE tracking.event_type ADD VALUE IF NOT EXISTS 'COD_COLLECTED'`);
  }

  public async down(): Promise<void> {
    // Intentionally a no-op: enum values are append-only. Dropping a value that historical
    // tracking rows may reference would corrupt the log.
  }
}
