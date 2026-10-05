/**
 * Adds SHIPMENT_CANCELLED to tracking.event_type.
 *
 * The cancel endpoint (POST /v1/shipments/:id/cancel) appends this event in the
 * same transaction as the status move. ALTER TYPE ... ADD VALUE is additive and
 * online-safe; the down migration is intentionally a no-op (see 0006).
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackingShipmentCancelled1759000000020 implements MigrationInterface {
  name = 'TrackingShipmentCancelled1759000000020';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TYPE tracking.event_type ADD VALUE IF NOT EXISTS 'SHIPMENT_CANCELLED'`);
  }

  public async down(): Promise<void> {
    // Intentionally a no-op: enum values are append-only.
  }
}
