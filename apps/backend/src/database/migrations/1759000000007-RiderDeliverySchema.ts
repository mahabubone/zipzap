/**
 * rider.riders, delivery.jobs, delivery.attempts — plus the delivery:create scope.
 *
 * Scope enum values are append-only: Postgres cannot remove a value that rows reference, so a
 * scope added is a scope kept. The CHECK doctrine applies only to business state, never to the
 * vocabulary of permissions.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';
import { RIDER_STATUSES } from '../../modules/rider/rules/rider.ts';
import { DELIVERY_STATUSES, FAILURE_REASONS } from '../../modules/delivery/rules/delivery.ts';

const enumType = (values: readonly string[], name: string): string =>
  `CREATE TYPE ${name} AS ENUM (${values.map((v) => `'${v}'`).join(', ')})`;

export class RiderDeliverySchema1759000000007 implements MigrationInterface {
  name = 'RiderDeliverySchema1759000000007';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TYPE merchant.api_scope ADD VALUE IF NOT EXISTS 'delivery:create'`);

    await r.query(enumType(RIDER_STATUSES, 'rider.rider_status'));
    await r.query(`
      CREATE TABLE rider.riders (
        id                  uuid        PRIMARY KEY,
        display_name        text        NOT NULL,
        phone               text        NOT NULL UNIQUE,
        status              rider.rider_status NOT NULL,
        last_known_latitude double precision,
        last_known_longitude double precision,
        last_known_at       timestamptz,
        current_job_id      uuid,
        capacity            integer     NOT NULL,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(
      `CREATE INDEX riders_status_updated_idx ON rider.riders (status, updated_at DESC)`,
    );
    await r.query(
      `ALTER TABLE rider.riders ADD CONSTRAINT riders_capacity_positive CHECK (capacity > 0)`,
    );

    await r.query(enumType(DELIVERY_STATUSES, 'delivery.delivery_status'));
    await r.query(enumType(FAILURE_REASONS, 'delivery.failure_reason'));
    await r.query(`
      CREATE TABLE delivery.jobs (
        id                  uuid        PRIMARY KEY,
        shipment_id         uuid        NOT NULL,
        rider_id            uuid,
        status              delivery.delivery_status NOT NULL,
        attempts_made       integer     NOT NULL DEFAULT 0,
        last_failure_reason delivery.failure_reason,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(`CREATE UNIQUE INDEX jobs_shipment_idx ON delivery.jobs (shipment_id)`);
    await r.query(`CREATE INDEX jobs_rider_status_idx ON delivery.jobs (rider_id, status)`);
    await r.query(
      `ALTER TABLE delivery.jobs ADD CONSTRAINT jobs_attempts_non_negative CHECK (attempts_made >= 0)`,
    );

    await r.query(`
      CREATE TABLE delivery.attempts (
        id          uuid        PRIMARY KEY,
        job_id      uuid        NOT NULL,
        sequence    integer     NOT NULL,
        reason      delivery.failure_reason NOT NULL,
        note        text,
        attempted_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(
      `CREATE UNIQUE INDEX attempts_job_seq_idx ON delivery.attempts (job_id, sequence)`,
    );
    await r.query(
      `ALTER TABLE delivery.attempts
         ADD CONSTRAINT attempts_sequence_positive CHECK (sequence > 0)`,
    );
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS delivery.attempts CASCADE`);
    await r.query(`DROP TABLE IF EXISTS delivery.jobs CASCADE`);
    await r.query(`DROP TYPE IF EXISTS delivery.failure_reason`);
    await r.query(`DROP TYPE IF EXISTS delivery.delivery_status`);
    await r.query(`DROP TABLE IF EXISTS rider.riders CASCADE`);
    await r.query(`DROP TYPE IF EXISTS rider.rider_status`);
  }
}
