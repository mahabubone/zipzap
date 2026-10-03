/**
 * pickup.pickups and the new API scopes.
 *
 * Two unrelated concerns, one migration — both are additive, both are enum-safe, and shipping
 * them together keeps the migration count honest. ALTER TYPE ... ADD VALUE is the one DDL that
 * cannot run inside a transaction block with other uses of the type, so it runs bare.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';
import { PICKUP_STATUSES } from '../../modules/pickup/rules/pickup.ts';

const enumType = (values: readonly string[], name: string): string =>
  `CREATE TYPE ${name} AS ENUM (${values.map((v) => `'${v}'`).join(', ')})`;

export class PickupSchema1759000000005 implements MigrationInterface {
  name = 'PickupSchema1759000000005';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TYPE merchant.api_scope ADD VALUE IF NOT EXISTS 'pickup:create'`);
    await r.query(`ALTER TYPE merchant.api_scope ADD VALUE IF NOT EXISTS 'pickup:read'`);
    await r.query(`ALTER TYPE merchant.api_scope ADD VALUE IF NOT EXISTS 'delivery:read'`);
    await r.query(`ALTER TYPE merchant.api_scope ADD VALUE IF NOT EXISTS 'delivery:complete'`);

    await r.query(enumType(PICKUP_STATUSES, 'pickup.pickup_status'));
    await r.query(`
      CREATE TABLE pickup.pickups (
        id                  uuid        PRIMARY KEY,
        merchant_id         uuid        NOT NULL,
        shipment_ids        uuid[]      NOT NULL,
        rider_id            uuid,
        status              pickup.pickup_status NOT NULL,
        failure_reason      text,
        total_weight_grams  integer     NOT NULL,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(
      `CREATE INDEX pickups_merchant_created_idx ON pickup.pickups (merchant_id, created_at DESC)`,
    );
    await r.query(
      `CREATE INDEX pickups_status_created_idx ON pickup.pickups (status, created_at DESC)`,
    );
    await r.query(
      `ALTER TABLE pickup.pickups
         ADD CONSTRAINT pickups_weight_positive CHECK (total_weight_grams > 0)`,
    );
    await r.query(
      `ALTER TABLE pickup.pickups
         ADD CONSTRAINT pickups_non_empty CHECK (cardinality(shipment_ids) > 0)`,
    );
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS pickup.pickups CASCADE`);
    await r.query(`DROP TYPE IF EXISTS pickup.pickup_status`);
    // Enum values are never removed: Postgres cannot drop a value in use, and a rollback that
    // destroys valid scopes would orphan live credentials. The added scopes simply persist.
  }
}
