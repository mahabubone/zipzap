/**
 * bulk_rows: allow outcome updates, keep DELETE blocked.
 *
 * Migration 0017 made bulk_rows fully append-only — but a bulk row is working
 * state, not evidence. It moves READY -> CREATED / FAILED / SKIPPED_DUPLICATE
 * as the chunk processor works, and the trigger rejected every one of those
 * updates live. The immutable-evidence rule lives in the result CSV (derived
 * from the final rows) plus the per-shipment outbox trail, not in freezing
 * the working rows. DELETE stays blocked: rows are never removed.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BulkRowsMutableOutcome1759000000018 implements MigrationInterface {
  name = 'BulkRowsMutableOutcome1759000000018';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`DROP TRIGGER IF EXISTS bulk_rows_no_update ON shipment.bulk_rows`);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TRIGGER bulk_rows_no_update
        BEFORE UPDATE ON shipment.bulk_rows
        FOR EACH ROW EXECUTE FUNCTION shipment.bulk_rows_are_immutable()
    `);
  }
}
