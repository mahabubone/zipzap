/**
 * notification.messages + notification.deliveries — the SMS skeleton.
 *
 * Messages are the intent (one per event+recipient, deduped); deliveries are the
 * immutable attempt log (one row per try). Templates live as versioned rows here
 * too: a message sent last month must be reproducible for a dispute, so the
 * template version rides on the delivery row, not just the text.
 *
 * Dead-letter is carrier-aware: only the carrier's retry policy 0 is permanent.
 * The DLR name + policy land on the delivery row, so the decision is auditable.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationSchema1759000000016 implements MigrationInterface {
  name = 'NotificationSchema1759000000016';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE notification.templates (
        id              uuid        PRIMARY KEY,
        name            text        NOT NULL,
        version         integer     NOT NULL,
        channel         text        NOT NULL CHECK (channel IN ('sms', 'email', 'push')),
        locale          text        NOT NULL,
        body            text        NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now(),
        UNIQUE (name, version)
      )
    `);

    await r.query(`
      CREATE TABLE notification.messages (
        id              uuid        PRIMARY KEY,
        event_id        text        NOT NULL,
        channel         text        NOT NULL CHECK (channel IN ('sms', 'email', 'push')),
        recipient       text        NOT NULL,
        template_name   text        NOT NULL,
        template_version integer    NOT NULL,
        body            text        NOT NULL,
        status          text        NOT NULL CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'DEAD_LETTERED')),
        created_at      timestamptz NOT NULL DEFAULT now(),
        UNIQUE (event_id, channel, recipient)
      )
    `);
    await r.query(
      `CREATE INDEX messages_status_created_idx ON notification.messages (status, created_at DESC)`,
    );

    await r.query(`
      CREATE TABLE notification.deliveries (
        id              uuid        PRIMARY KEY,
        message_id      uuid        NOT NULL,
        attempt         integer     NOT NULL,
        provider_ref    text,
        tracking_id     text,
        segments        integer,
        dlr_name        text,
        carrier_policy  integer,
        delivered       boolean     NOT NULL DEFAULT false,
        terminal        boolean     NOT NULL DEFAULT false,
        error           text,
        attempted_at    timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(
      `CREATE INDEX deliveries_message_idx ON notification.deliveries (message_id, attempted_at DESC)`,
    );

    // The delivery log is evidence. Same trigger shape as the ledger.
    await r.query(`
      CREATE OR REPLACE FUNCTION notification.deliveries_are_immutable()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION
          'notification.deliveries is append-only: % is not permitted.',
          TG_OP
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql
    `);
    await r.query(`
      CREATE TRIGGER deliveries_no_update
        BEFORE UPDATE ON notification.deliveries
        FOR EACH ROW EXECUTE FUNCTION notification.deliveries_are_immutable()
    `);
    await r.query(`
      CREATE TRIGGER deliveries_no_delete
        BEFORE DELETE ON notification.deliveries
        FOR EACH ROW EXECUTE FUNCTION notification.deliveries_are_immutable()
    `);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS notification.deliveries CASCADE`);
    await r.query(`DROP FUNCTION IF EXISTS notification.deliveries_are_immutable()`);
    await r.query(`DROP TABLE IF EXISTS notification.messages CASCADE`);
    await r.query(`DROP TABLE IF EXISTS notification.templates CASCADE`);
  }
}
