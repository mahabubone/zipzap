import type { MigrationInterface, QueryRunner } from 'typeorm';
import { NOTIFIABLE_EVENTS } from '../../modules/notification/rules/preferences.ts';

/**
 * `notification.merchant_preferences` + the `notifications:manage` scope.
 *
 * A row is an opt-OUT. There is deliberately no row for an enabled event, and no backfill: the
 * system has been sending every parcel event to every customer since it existed, and a migration
 * that wrote a row saying "off" would stop those messages. A merchant who wants silence creates the
 * row; nobody else does. See `rules/preferences.ts` for why the default has to be "send".
 *
 * `event_type` is constrained to the events that actually notify rather than to a CHECK listing
 * them by hand, and the list is imported from the same map the consumer reads. A fourth parcel
 * event therefore cannot be added to the consumer and left un-configurable here — the migration
 * would fail instead, which is the point of importing rather than retyping.
 *
 * The scope is merchant-facing and not owner-only: silencing your own customers' SMS is an
 * operator's decision, and it is reversible. It is not a platform scope, so `MERCHANT_SCOPES`
 * picks it up by derivation with no second edit.
 */
export class NotificationPreferences1759000000045 implements MigrationInterface {
  name = 'NotificationPreferences1759000000045';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TYPE merchant.api_scope ADD VALUE IF NOT EXISTS 'notifications:manage'`);

    await r.query(`
      CREATE TABLE notification.merchant_preferences (
        merchant_id uuid        NOT NULL,
        event_type  text        NOT NULL CHECK (event_type IN (${NOTIFIABLE_EVENTS.map((e) => `'${e}'`).join(', ')})),
        enabled     boolean     NOT NULL,
        updated_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (merchant_id, event_type)
      )
    `);

    await r.query(
      `COMMENT ON TABLE notification.merchant_preferences IS
       'Opt-out rows only: absent means send. A merchant who mutes an event writes a row here with enabled=false; nothing else ever writes one.'`,
    );
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS notification.merchant_preferences`);
  }
}
