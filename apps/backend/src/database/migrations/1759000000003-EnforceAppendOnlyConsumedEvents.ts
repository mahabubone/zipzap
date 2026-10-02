/**
 * Enforce append-only on system.consumed_events.
 *
 * Same root cause as EnforceAppendOnlyOutbox: REVOKE from the table owner is a no-op in
 * PostgreSQL. This table is the consumer-side dedupe ledger — if a row can be deleted, an
 * already-processed event replays, and at-least-once delivery silently becomes
 * effectively-at-least-once-more-than-once. See docs/ADR/0006-nats-jetstream.md.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceAppendOnlyConsumedEvents1759000000003 implements MigrationInterface {
  name = 'EnforceAppendOnlyConsumedEvents1759000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION system.consumed_events_are_immutable()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION
          'system.consumed_events is append-only: % is not permitted. It is the consumer dedupe ledger.',
          TG_OP
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER consumed_events_no_update
        BEFORE UPDATE ON system.consumed_events
        FOR EACH ROW EXECUTE FUNCTION system.consumed_events_are_immutable()
    `);

    await queryRunner.query(`
      CREATE TRIGGER consumed_events_no_delete
        BEFORE DELETE ON system.consumed_events
        FOR EACH ROW EXECUTE FUNCTION system.consumed_events_are_immutable()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS consumed_events_no_delete ON system.consumed_events',
    );
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS consumed_events_no_update ON system.consumed_events',
    );
    await queryRunner.query('DROP FUNCTION IF EXISTS system.consumed_events_are_immutable()');
  }
}
