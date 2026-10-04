/**
 * consumed_events.event_id: bigint -> text.
 *
 * The publisher sends the outbox row id stringified into the JSON envelope, and both consumers
 * write that string straight into event_id. Numeric strings cast silently, so this worked until
 * a non-numeric event id arrived — then every consumer failed with "invalid input syntax for
 * type bigint". The event id is an opaque dedupe key; only per-consumer uniqueness matters, so
 * the column type was wrong, not the code. Existing rows cast losslessly via ::text.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ConsumedEventsTextId1759000000012 implements MigrationInterface {
  name = 'ConsumedEventsTextId1759000000012';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(
      `ALTER TABLE system.consumed_events ALTER COLUMN event_id TYPE text USING event_id::text`,
    );
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(
      `ALTER TABLE system.consumed_events ALTER COLUMN event_id TYPE bigint USING event_id::bigint`,
    );
  }
}
