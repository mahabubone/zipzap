/**
 * `cod.records.review_note` and `cod.records.reviewed_by` — who cleared a mismatch, and why.
 *
 * The column `failure_note` already existed and nothing ever wrote it. It was the wrong shape for
 * this: a failure note describes the *problem*, and the plan's exit check asks for the *reviewer's
 * note* — the decision a human made about it. Those are two different facts and conflating them
 * loses whichever one is not written.
 *
 * The review note was, until now, only ever a JSON blob inside `tracking.events.metadata.reviewNote`
 * and inside the `CODReconciled` outbox payload. That is a real record, but it is unreachable: no
 * endpoint reads tracking metadata for ops, and the exception queue is supposed to be a work queue
 * a human works through. A reviewer note you cannot see while reviewing is not an audit trail.
 *
 * Both columns are nullable and backfilled NULL: existing rows genuinely were never reviewed by
 * anyone, and writing a placeholder would invent a reviewer.
 *
 * `reviewed_at` is derived from `updated_at`? No — `updated_at` moves on every write, including
 * unrelated ones, and an audit field that changes when nothing was reviewed is worse than none.
 * It gets its own column.
 *
 * The partial index is on `status = 'RECONCILIATION_EXCEPTION'` because that is the queue: the
 * exception list reads exactly those rows, newest first, and it is a small subset of the table.
 * Indexing the whole status column for one query would pay on every write to help one read.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CodExceptionReview1759000000038 implements MigrationInterface {
  name = 'CodExceptionReview1759000000038';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TABLE cod.records ADD COLUMN IF NOT EXISTS review_note text`);
    await r.query(`ALTER TABLE cod.records ADD COLUMN IF NOT EXISTS reviewed_by uuid`);
    await r.query(`ALTER TABLE cod.records ADD COLUMN IF NOT EXISTS reviewed_at timestamptz`);

    await r.query(`
      CREATE INDEX IF NOT EXISTS records_open_exceptions_idx
        ON cod.records (merchant_id, created_at DESC)
        WHERE status = 'RECONCILIATION_EXCEPTION'
    `);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP INDEX IF EXISTS cod.records_open_exceptions_idx`);
    await r.query(`ALTER TABLE cod.records DROP COLUMN IF EXISTS review_note`);
    await r.query(`ALTER TABLE cod.records DROP COLUMN IF EXISTS reviewed_by`);
    await r.query(`ALTER TABLE cod.records DROP COLUMN IF EXISTS reviewed_at`);
  }
}
