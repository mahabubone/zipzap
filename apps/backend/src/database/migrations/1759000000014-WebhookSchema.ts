/**
 * merchant.webhook_endpoints + merchant.webhook_deliveries — the Phase 4 skeleton.
 *
 * Endpoints belong to merchant (they are per-merchant integration config, owned with
 * the credential that manages them). Deliveries are the immutable attempt log:
 * append-only by trigger, like the ledger — a disputed delivery is settled from
 * this log, so it must be unrewritable even by hand.
 *
 * Status is a plain text CHECK, not an enum: ACTIVE | PAUSED | FAILING. An enum
 * would force a migration for every future state; the machine lives in rules/.
 *
 * secret_hash, never the secret: the secret is shown once at creation/rotation,
 * then only the hash remains. Same shape as api_credentials, same reason.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WebhookSchema1759000000014 implements MigrationInterface {
  name = 'WebhookSchema1759000000014';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TYPE merchant.api_scope ADD VALUE IF NOT EXISTS 'webhooks:manage'`);

    await r.query(`
      CREATE TABLE merchant.webhook_endpoints (
        id              uuid        PRIMARY KEY,
        merchant_id     uuid        NOT NULL,
        url             text        NOT NULL,
        events          text[]      NOT NULL,
        secret_hash     text        NOT NULL,
        status          text        NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'FAILING')),
        consecutive_failures integer NOT NULL DEFAULT 0,
        last_success_at timestamptz,
        last_failure_at timestamptz,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(
      `CREATE INDEX webhook_endpoints_merchant_idx ON merchant.webhook_endpoints (merchant_id)`,
    );

    await r.query(`
      CREATE TABLE merchant.webhook_deliveries (
        id              uuid        PRIMARY KEY,
        endpoint_id     uuid        NOT NULL,
        merchant_id     uuid        NOT NULL,
        event_type      text        NOT NULL,
        payload         jsonb       NOT NULL,
        attempt         integer     NOT NULL,
        status_code     integer,
        response_body   text,
        error           text,
        delivered       boolean     NOT NULL DEFAULT false,
        terminal        boolean     NOT NULL DEFAULT false,
        attempted_at    timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(
      `CREATE INDEX webhook_deliveries_endpoint_idx ON merchant.webhook_deliveries (endpoint_id, attempted_at DESC)`,
    );

    // The delivery log is evidence. REVOKE from the owner is a no-op in PostgreSQL,
    // so a trigger rejects UPDATE and DELETE outright — same shape as the ledger.
    await r.query(`
      CREATE OR REPLACE FUNCTION merchant.webhook_deliveries_are_immutable()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION
          'merchant.webhook_deliveries is append-only: % is not permitted.',
          TG_OP
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql
    `);
    await r.query(`
      CREATE TRIGGER webhook_deliveries_no_update
        BEFORE UPDATE ON merchant.webhook_deliveries
        FOR EACH ROW EXECUTE FUNCTION merchant.webhook_deliveries_are_immutable()
    `);
    await r.query(`
      CREATE TRIGGER webhook_deliveries_no_delete
        BEFORE DELETE ON merchant.webhook_deliveries
        FOR EACH ROW EXECUTE FUNCTION merchant.webhook_deliveries_are_immutable()
    `);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS merchant.webhook_deliveries CASCADE`);
    await r.query(`DROP FUNCTION IF EXISTS merchant.webhook_deliveries_are_immutable()`);
    await r.query(`DROP TABLE IF EXISTS merchant.webhook_endpoints CASCADE`);
  }
}
