/**
 * EXCEPTION_RAISED on the tracking timeline (Phase 6 rung 4).
 *
 * Lost and damaged parcels must appear on the public timeline — a shipment
 * that vanishes from tracking is a lie by omission. The enum is shared by
 * tracking.events and tracking.public_timeline, so one value feeds both the
 * authoritative log and the consumer's projection.
 *
 * ALTER TYPE ... ADD VALUE runs first, before anything else uses the type —
 * see PickupSchema1759000000005 for the transaction note.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExceptionRaisedEventType1759000000030 implements MigrationInterface {
  name = 'AddExceptionRaisedEventType1759000000030';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TYPE tracking.event_type ADD VALUE IF NOT EXISTS 'EXCEPTION_RAISED'`);
  }

  public async down(_r: QueryRunner): Promise<void> {
    // Enum values cannot be removed portably; leaving the value in place is
    // harmless (it is simply never written again).
  }
}
