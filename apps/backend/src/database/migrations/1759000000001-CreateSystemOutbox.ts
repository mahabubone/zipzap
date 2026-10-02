/**
 * system.outbox_events · system.consumed_events · system.idempotency_keys
 *
 * The three tables that make ADR-0005, ADR-0006 and ADR-0010 real. Every module writes to
 * `outbox_events` — that is the one deliberate exception to module isolation, because the
 * outbox is the mechanism that makes isolation possible.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSystemOutbox1759000000001 implements MigrationInterface {
  name = 'CreateSystemOutbox1759000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS system.outbox_events (
        id             bigserial   PRIMARY KEY,
        event_type     text        NOT NULL,
        event_version  integer     NOT NULL DEFAULT 1,
        aggregate_type text        NOT NULL,
        aggregate_id   text        NOT NULL,
        payload        jsonb       NOT NULL,
        occurred_at    timestamptz NOT NULL,
        published_at   timestamptz,
        attempts       integer     NOT NULL DEFAULT 0,
        last_error     text
      )
    `);

    // The publisher's hot path. Partial, so drained rows stop costing anything.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS outbox_events_unpublished_idx
        ON system.outbox_events (id)
        WHERE published_at IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS system.consumed_events (
        consumer     text        NOT NULL,
        event_id     bigint      NOT NULL,
        consumed_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (consumer, event_id)
      )
    `);

    // `scope` already encodes operation class + merchant (see common/idempotency.ts), so
    // system does not need to know another module's identifier type.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS system.idempotency_keys (
        scope          text        NOT NULL,
        idempotency_key text       NOT NULL,
        request_hash   text        NOT NULL,
        response_code  integer,
        response_body  jsonb,
        created_at     timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (scope, idempotency_key)
      )
    `);

    // Append-only, enforced by the database rather than by code review.
    //
    // Column-level on outbox_events: the event data is immutable, but the publisher must
    // still write its own bookkeeping columns (published_at, attempts, last_error). A blanket
    // REVOKE UPDATE would stop the publisher doing its job.
    await queryRunner.query(`
      REVOKE UPDATE (event_type, event_version, aggregate_type, aggregate_id, payload, occurred_at)
        ON system.outbox_events FROM CURRENT_USER
    `);
    await queryRunner.query('REVOKE DELETE ON system.outbox_events FROM CURRENT_USER');

    // consumed_events is genuinely insert-and-read only.
    await queryRunner.query('REVOKE UPDATE, DELETE ON system.consumed_events FROM CURRENT_USER');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS system.idempotency_keys');
    await queryRunner.query('DROP TABLE IF EXISTS system.consumed_events');
    await queryRunner.query('DROP TABLE IF EXISTS system.outbox_events');
  }
}
