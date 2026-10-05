/**
 * shipment.bulk_jobs + shipment.bulk_rows — the bulk import skeleton.
 *
 * Jobs are the merchant-visible unit (upload → preview → accept → process);
 * rows are the per-row outcomes. The raw file is NOT stored: the preview rows
 * plus the result download are the record. Storing 10,000-row uploads would make
 * the database a file store.
 *
 * Idempotency is on (merchant, invoice): re-uploading a corrected file skips
 * existing invoices instead of doubling parcels. The dedupe check is per row
 * against shipment by merchant invoice reference — which lives on the shipment
 * row as merchant_reference (added here).
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';
import { BULK_JOB_STATUSES } from '../../modules/shipment/rules/bulk.ts';

export class BulkSchema1759000000017 implements MigrationInterface {
  name = 'BulkSchema1759000000017';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(
      `CREATE TYPE shipment.bulk_job_status AS ENUM (${BULK_JOB_STATUSES.map((s) => `'${s}'`).join(', ')})`,
    );

    await r.query(`
      CREATE TABLE shipment.bulk_jobs (
        id              uuid        PRIMARY KEY,
        merchant_id     uuid        NOT NULL,
        filename        text        NOT NULL,
        status          shipment.bulk_job_status NOT NULL,
        total_rows      integer     NOT NULL DEFAULT 0,
        processed_rows  integer     NOT NULL DEFAULT 0,
        succeeded_rows  integer     NOT NULL DEFAULT 0,
        failed_rows     integer     NOT NULL DEFAULT 0,
        skipped_rows    integer     NOT NULL DEFAULT 0,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(
      `CREATE INDEX bulk_jobs_merchant_created_idx ON shipment.bulk_jobs (merchant_id, created_at DESC)`,
    );

    await r.query(`
      CREATE TABLE shipment.bulk_rows (
        id              uuid        PRIMARY KEY,
        job_id          uuid        NOT NULL,
        line_number     integer     NOT NULL,
        invoice         text        NOT NULL,
        fields          jsonb       NOT NULL,
        outcome         text        NOT NULL,
        reason          text,
        shipment_id     uuid,
        created_at      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(`CREATE INDEX bulk_rows_job_idx ON shipment.bulk_rows (job_id, line_number)`);
    await r.query(
      `CREATE UNIQUE INDEX bulk_rows_job_invoice_idx ON shipment.bulk_rows (job_id, invoice)`,
    );

    // Merchant invoice reference on the shipment: the bulk dedupe anchor.
    await r.query(`ALTER TABLE shipment.shipments ADD COLUMN merchant_reference text`);
    await r.query(
      `CREATE UNIQUE INDEX shipments_merchant_reference_idx ON shipment.shipments (merchant_id, merchant_reference) WHERE merchant_reference IS NOT NULL`,
    );

    // Jobs move forward only; rows are append-only evidence.
    await r.query(`
      CREATE OR REPLACE FUNCTION shipment.bulk_jobs_guard_transition()
      RETURNS trigger AS $$
      DECLARE
        allowed boolean;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'shipment.bulk_jobs cannot be deleted.'
            USING ERRCODE = 'restrict_violation';
        END IF;

        allowed := CASE OLD.status::text
          WHEN 'PENDING' THEN NEW.status::text = 'VALIDATING'
          WHEN 'VALIDATING' THEN NEW.status::text IN ('PREVIEW', 'FAILED')
          WHEN 'PREVIEW' THEN NEW.status::text IN ('PROCESSING', 'FAILED')
          WHEN 'PROCESSING' THEN NEW.status::text IN ('COMPLETED', 'FAILED', 'COMPLETED_WITH_ERRORS')
          ELSE false
        END;

        IF NOT allowed THEN
          RAISE EXCEPTION 'Illegal bulk job transition % -> %.', OLD.status, NEW.status
            USING ERRCODE = 'restrict_violation';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await r.query(`
      CREATE TRIGGER bulk_jobs_no_delete
        BEFORE DELETE ON shipment.bulk_jobs
        FOR EACH ROW EXECUTE FUNCTION shipment.bulk_jobs_guard_transition()
    `);
    await r.query(`
      CREATE TRIGGER bulk_jobs_guard_update
        BEFORE UPDATE ON shipment.bulk_jobs
        FOR EACH ROW EXECUTE FUNCTION shipment.bulk_jobs_guard_transition()
    `);

    await r.query(`
      CREATE OR REPLACE FUNCTION shipment.bulk_rows_are_immutable()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION
          'shipment.bulk_rows is append-only: % is not permitted.',
          TG_OP
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql
    `);
    await r.query(`
      CREATE TRIGGER bulk_rows_no_update
        BEFORE UPDATE ON shipment.bulk_rows
        FOR EACH ROW EXECUTE FUNCTION shipment.bulk_rows_are_immutable()
    `);
    await r.query(`
      CREATE TRIGGER bulk_rows_no_delete
        BEFORE DELETE ON shipment.bulk_rows
        FOR EACH ROW EXECUTE FUNCTION shipment.bulk_rows_are_immutable()
    `);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TABLE shipment.shipments DROP COLUMN IF EXISTS merchant_reference`);
    await r.query(`DROP TABLE IF EXISTS shipment.bulk_rows CASCADE`);
    await r.query(`DROP FUNCTION IF EXISTS shipment.bulk_rows_are_immutable()`);
    await r.query(`DROP TABLE IF EXISTS shipment.bulk_jobs CASCADE`);
    await r.query(`DROP FUNCTION IF EXISTS shipment.bulk_jobs_guard_transition()`);
    await r.query(`DROP TYPE IF EXISTS shipment.bulk_job_status`);
  }
}
