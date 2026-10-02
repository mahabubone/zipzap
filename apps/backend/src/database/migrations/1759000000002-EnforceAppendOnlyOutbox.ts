/**
 * Actually enforce append-only on system.outbox_events.
 *
 * Why this migration exists: `REVOKE UPDATE (…) FROM CURRENT_USER` in
 * CreateSystemOutbox1759000000001 does nothing, because in PostgreSQL the table *owner*
 * always retains every privilege regardless of the ACL. The ACL after that REVOKE reads
 * `{zipzap=arwDxtm/zipzap}` — the app still had full UPDATE and DELETE.
 *
 * A trigger works regardless of which role runs it, and needs no separate owner/app role
 * split, which is the right trade at this stage.
 *
 * `ponytail:` database roles are the stronger enforcement — the migration connects as an
 * owner, the app connects as a role holding only INSERT/SELECT plus UPDATE on the three
 * bookkeeping columns. That needs a second DATABASE_URL (migrator vs runtime) and init SQL.
 * Add it when there is a real deployment; the trigger is correct until then, not a
 * placeholder for it.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

const EVENT_COLUMNS = [
  'event_type',
  'event_version',
  'aggregate_type',
  'aggregate_id',
  'payload',
  'occurred_at',
];

export class EnforceAppendOnlyOutbox1759000000002 implements MigrationInterface {
  name = 'EnforceAppendOnlyOutbox1759000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION system.outbox_events_are_immutable()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION
          'system.outbox_events is append-only: % cannot be changed or deleted. Append a new event instead.',
          TG_OP
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql
    `);

    // BEFORE UPDATE ... FOR EACH ROW, comparing OLD and NEW. Any difference in the event
    // columns is rejected; the publisher's bookkeeping columns (published_at, attempts,
    // last_error) are untouched by this and remain writable.
    const anyEventColumnChanged = EVENT_COLUMNS.map(
      (column) => `NEW.${column} IS DISTINCT FROM OLD.${column}`,
    ).join('\n          OR ');

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION system.outbox_events_guard_update()
      RETURNS trigger AS $$
      BEGIN
        IF ${anyEventColumnChanged} THEN
          RAISE EXCEPTION
            'system.outbox_events is append-only: event columns are immutable. Append a new event instead.'
            USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER outbox_events_no_delete
        BEFORE DELETE ON system.outbox_events
        FOR EACH ROW EXECUTE FUNCTION system.outbox_events_are_immutable()
    `);

    await queryRunner.query(`
      CREATE TRIGGER outbox_events_no_mutation
        BEFORE UPDATE ON system.outbox_events
        FOR EACH ROW EXECUTE FUNCTION system.outbox_events_guard_update()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS outbox_events_no_mutation ON system.outbox_events',
    );
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS outbox_events_no_delete ON system.outbox_events',
    );
    await queryRunner.query('DROP FUNCTION IF EXISTS system.outbox_events_guard_update()');
    await queryRunner.query('DROP FUNCTION IF EXISTS system.outbox_events_are_immutable()');
  }
}
