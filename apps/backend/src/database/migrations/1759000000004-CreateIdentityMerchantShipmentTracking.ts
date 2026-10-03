/**
 * First real domain tables: identity, merchant, shipment, tracking.
 *
 * Notes that are load-bearing rather than incidental:
 *  - tracking.events is append-only, enforced by TRIGGER. `REVOKE` from the table owner is a
 *    no-op in PostgreSQL, which was verified against a live database — see migration 0002.
 *  - cod_amount_minor is bigint. Money is never a float (ADR-0009).
 *  - No cross-schema foreign keys. A `merchant_id` in shipment is a bare identifier (ADR-0002).
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';
import { MERCHANT_STATUSES } from '../../modules/merchant/domain/merchant.ts';
import { API_SCOPES } from '../../common/scopes.ts';
import { SHIPMENT_STATUSES } from '../../modules/shipment/domain/state-machine.ts';
import { TRACKING_EVENT_TYPES } from '../../modules/tracking/domain/tracking-event.ts';

/** Postgres enum type. Names are schema-qualified so two modules may use the same name. */
const enumType = (values: readonly string[], name: string): string =>
  `CREATE TYPE ${name} AS ENUM (${values.map((v) => `'${v}'`).join(', ')})`;

export class CreateIdentityMerchantShipmentTracking1759000000004 implements MigrationInterface {
  name = 'CreateIdentityMerchantShipmentTracking1759000000004';

  public async up(r: QueryRunner): Promise<void> {
    // --- identity -----------------------------------------------------------------
    // Intentionally empty: identity owns no tables in this slice. API credentials are merchant
    // data (docs/domains/merchant.md), so identity verifies a key through merchant's service.

    // --- merchant -----------------------------------------------------------------
    await r.query(enumType(MERCHANT_STATUSES, 'merchant.merchant_status'));
    await r.query(enumType(API_SCOPES, 'merchant.api_scope'));
    await r.query(`
      CREATE TABLE merchant.api_credentials (
        id           uuid        PRIMARY KEY,
        merchant_id  uuid        NOT NULL,
        key_id       text        NOT NULL,
        secret_hash  text        NOT NULL,
        scopes       merchant.api_scope[] NOT NULL,
        last_used_at timestamptz,
        revoked_at   timestamptz,
        created_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(
      `CREATE UNIQUE INDEX api_credentials_key_id_idx ON merchant.api_credentials (key_id)`,
    );
    await r.query(`
      CREATE TABLE merchant.merchants (
        id            uuid        PRIMARY KEY,
        name          text        NOT NULL,
        status        merchant.merchant_status NOT NULL,
        contact_email text        NOT NULL UNIQUE,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Credentials and merchants are both merchant tables, so this FK is legitimate — unlike
    // every cross-module reference in this migration, which is a bare identifier.
    await r.query(`
      ALTER TABLE merchant.api_credentials
        ADD CONSTRAINT api_credentials_merchant_fk
        FOREIGN KEY (merchant_id) REFERENCES merchant.merchants (id)
    `);

    // --- shipment -----------------------------------------------------------------
    await r.query(enumType(SHIPMENT_STATUSES, 'shipment.shipment_status'));
    await r.query(`
      CREATE TABLE shipment.shipments (
        id                    uuid        PRIMARY KEY,
        tracking_code         text        NOT NULL,
        merchant_id           uuid        NOT NULL,
        sender_name           text        NOT NULL,
        sender_phone          text        NOT NULL,
        sender_address        text        NOT NULL,
        recipient_name        text        NOT NULL,
        recipient_phone       text        NOT NULL,
        recipient_address     text        NOT NULL,
        parcel_weight_grams   integer     NOT NULL,
        parcel_description    text        NOT NULL,
        cod_amount_minor      bigint      NOT NULL,
        cod_currency          char(3)     NOT NULL,
        status                shipment.shipment_status NOT NULL,
        held_from_status      shipment.shipment_status,
        pricing_version       integer     NOT NULL,
        created_at            timestamptz NOT NULL DEFAULT now(),
        updated_at            timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(
      `CREATE UNIQUE INDEX shipments_tracking_code_idx ON shipment.shipments (tracking_code)`,
    );
    await r.query(
      `CREATE INDEX shipments_merchant_created_idx ON shipment.shipments (merchant_id, created_at DESC)`,
    );
    await r.query(
      `CREATE INDEX shipments_status_created_idx ON shipment.shipments (status, created_at DESC)`,
    );
    await r.query(
      `ALTER TABLE shipment.shipments
         ADD CONSTRAINT shipments_cod_non_negative CHECK (cod_amount_minor >= 0)`,
    );
    // A weight of zero is not a parcel. Enforced here rather than only in the application,
    // because a migration or a manual fix can otherwise bypass application validation.
    await r.query(
      `ALTER TABLE shipment.shipments
         ADD CONSTRAINT shipments_weight_positive CHECK (parcel_weight_grams > 0)`,
    );

    // --- tracking -----------------------------------------------------------------
    await r.query(enumType(TRACKING_EVENT_TYPES, 'tracking.event_type'));
    await r.query(`
      CREATE TABLE tracking.events (
        id                uuid        PRIMARY KEY,
        shipment_id       uuid        NOT NULL,
        event_type        tracking.event_type NOT NULL,
        occurred_at       timestamptz NOT NULL,
        recorded_at       timestamptz NOT NULL DEFAULT now(),
        actor_type        text        NOT NULL,
        actor_id          uuid,
        metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
        corrects_event_id uuid
      )
    `);
    await r.query(
      `CREATE INDEX events_shipment_occurred_idx ON tracking.events (shipment_id, occurred_at)`,
    );
    await r.query(
      `CREATE INDEX events_corrects_idx ON tracking.events (corrects_event_id) WHERE corrects_event_id IS NOT NULL`,
    );

    await r.query(`
      CREATE TABLE tracking.public_timeline (
        id           uuid        PRIMARY KEY,
        tracking_code text       NOT NULL,
        shipment_id  uuid        NOT NULL,
        sequence     integer     NOT NULL,
        event_type   tracking.event_type NOT NULL,
        occurred_at  timestamptz NOT NULL,
        projected_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(
      `CREATE INDEX public_timeline_code_seq_idx ON tracking.public_timeline (tracking_code, sequence)`,
    );

    // Append-only. A trigger, because REVOKE from the owner is a no-op.
    await r.query(`
      CREATE OR REPLACE FUNCTION tracking.events_are_immutable()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION
          'tracking.events is append-only: % is not permitted. Append a new event instead.',
          TG_OP
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql
    `);
    await r.query(`
      CREATE TRIGGER events_no_update
        BEFORE UPDATE ON tracking.events
        FOR EACH ROW EXECUTE FUNCTION tracking.events_are_immutable()
    `);
    await r.query(`
      CREATE TRIGGER events_no_delete
        BEFORE DELETE ON tracking.events
        FOR EACH ROW EXECUTE FUNCTION tracking.events_are_immutable()
    `);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS tracking.public_timeline`);
    await r.query(`DROP TABLE IF EXISTS tracking.events CASCADE`);
    await r.query(`DROP FUNCTION IF EXISTS tracking.events_are_immutable()`);
    await r.query(`DROP TYPE IF EXISTS tracking.event_type`);
    await r.query(`DROP TABLE IF EXISTS shipment.shipments CASCADE`);
    await r.query(`DROP TYPE IF EXISTS shipment.shipment_status`);
    await r.query(
      `ALTER TABLE merchant.api_credentials DROP CONSTRAINT IF EXISTS api_credentials_merchant_fk`,
    );
    await r.query(`DROP TABLE IF EXISTS merchant.api_credentials CASCADE`);
    await r.query(`DROP TABLE IF EXISTS merchant.merchants CASCADE`);
    await r.query(`DROP TYPE IF EXISTS merchant.merchant_status`);
    await r.query(`DROP TABLE IF EXISTS identity.api_credentials CASCADE`);
    await r.query(`DROP TYPE IF EXISTS merchant.api_scope`);
  }
}
