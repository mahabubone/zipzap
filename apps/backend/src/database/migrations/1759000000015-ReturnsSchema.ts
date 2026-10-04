/**
 * returns.requests — the return lifecycle table.
 *
 * Status transitions are guarded by the same trigger shape as settlements: the
 * row may only move along the RETURN_REQUESTED -> ... -> RETURNED chain, or to
 * RETURN_REJECTED from REQUESTED. History is a chain of forward moves — a
 * rejected or completed return is never reopened, only re-requested.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';
import { RETURN_REASONS, RETURN_STATUSES } from '../../modules/returns/rules/returns.ts';

export class ReturnsSchema1759000000015 implements MigrationInterface {
  name = 'ReturnsSchema1759000000015';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(
      `CREATE TYPE returns.return_status AS ENUM (${RETURN_STATUSES.map((s) => `'${s}'`).join(', ')})`,
    );
    await r.query(
      `CREATE TYPE returns.return_reason AS ENUM (${RETURN_REASONS.map((s) => `'${s}'`).join(', ')})`,
    );

    await r.query(`
      CREATE TABLE returns.requests (
        id              uuid        PRIMARY KEY,
        shipment_id     uuid        NOT NULL,
        merchant_id     uuid        NOT NULL,
        reason          returns.return_reason NOT NULL,
        status          returns.return_status NOT NULL,
        review_note     text,
        decided_by      uuid,
        decided_at      timestamptz,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(`CREATE UNIQUE INDEX requests_shipment_idx ON returns.requests (shipment_id)`);
    await r.query(
      `CREATE INDEX requests_merchant_created_idx ON returns.requests (merchant_id, created_at DESC)`,
    );
    await r.query(
      `CREATE INDEX requests_status_created_idx ON returns.requests (status, created_at DESC)`,
    );

    await r.query(`
      CREATE OR REPLACE FUNCTION returns.requests_guard_transition()
      RETURNS trigger AS $$
      DECLARE
        allowed boolean;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'returns.requests cannot be deleted.'
            USING ERRCODE = 'restrict_violation';
        END IF;

        allowed := CASE OLD.status::text
          WHEN 'RETURN_REQUESTED' THEN NEW.status::text IN ('RETURN_APPROVED', 'RETURN_REJECTED')
          WHEN 'RETURN_APPROVED' THEN NEW.status::text = 'RETURN_INITIATED'
          WHEN 'RETURN_INITIATED' THEN NEW.status::text = 'RETURN_IN_TRANSIT'
          WHEN 'RETURN_IN_TRANSIT' THEN NEW.status::text = 'RETURN_AT_HUB'
          WHEN 'RETURN_AT_HUB' THEN NEW.status::text = 'RETURN_OUT_FOR_DELIVERY'
          WHEN 'RETURN_OUT_FOR_DELIVERY' THEN NEW.status::text = 'RETURNED'
          ELSE false
        END;

        IF NOT allowed THEN
          RAISE EXCEPTION 'Illegal return transition % -> %.', OLD.status, NEW.status
            USING ERRCODE = 'restrict_violation';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await r.query(`
      CREATE TRIGGER requests_no_delete
        BEFORE DELETE ON returns.requests
        FOR EACH ROW EXECUTE FUNCTION returns.requests_guard_transition()
    `);
    await r.query(`
      CREATE TRIGGER requests_guard_update
        BEFORE UPDATE ON returns.requests
        FOR EACH ROW EXECUTE FUNCTION returns.requests_guard_transition()
    `);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS returns.requests CASCADE`);
    await r.query(`DROP FUNCTION IF EXISTS returns.requests_guard_transition()`);
    await r.query(`DROP TYPE IF EXISTS returns.return_status`);
    await r.query(`DROP TYPE IF EXISTS returns.return_reason`);
  }
}
