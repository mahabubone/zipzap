/**
 * bulk_jobs: allow counter-only updates while PROCESSING.
 *
 * Migration 0017's guard only allowed status changes — but the chunk processor
 * bumps processed/succeeded/failed counts without changing status until the
 * last chunk. Every chunk commit hit `PROCESSING -> PROCESSING` and died live
 * on a 10k import (103 failed chunks). Same-status updates are counter writes,
 * not lifecycle moves: allow them, keep the forward-only lifecycle.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BulkJobsCounterUpdate1759000000019 implements MigrationInterface {
  name = 'BulkJobsCounterUpdate1759000000019';

  public async up(r: QueryRunner): Promise<void> {
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

        IF OLD.status::text = NEW.status::text THEN
          RETURN NEW;
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
  }

  public async down(r: QueryRunner): Promise<void> {
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
  }
}
