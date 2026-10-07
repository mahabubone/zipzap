/**
 * Tracking timeline vocabulary: SHIPMENT_HELD and SHIPMENT_RELEASED.
 *
 * Same ALTER TYPE pattern as 0011/0020/0030. Additive and online-safe; the
 * down migration is a no-op because enum values are append-only history.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackingHoldReleased1759000000032 implements MigrationInterface {
  name = 'TrackingHoldReleased1759000000032';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TYPE tracking.event_type ADD VALUE IF NOT EXISTS 'SHIPMENT_HELD'`);
    await r.query(`ALTER TYPE tracking.event_type ADD VALUE IF NOT EXISTS 'SHIPMENT_RELEASED'`);
  }

  public async down(): Promise<void> {
    // Enum values cannot be removed portably.
  }
}
