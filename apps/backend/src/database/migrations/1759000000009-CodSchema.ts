/**
 * cod.records — one row per shipment that carries COD.
 *
 * `expected_minor` is the promise from the frozen quote. It is written once, at record
 * creation, and never overwritten by collection: the gap between promise and reality is exactly
 * what reconciliation measures. `collected_minor` starts NULL — unknown, not zero — because
 * "not yet collected" and "collected nothing" are different facts.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';
import { COD_STATUSES } from '../../modules/cod/rules/cod.ts';

export class CodSchema1759000000009 implements MigrationInterface {
  name = 'CodSchema1759000000009';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(
      `CREATE TYPE cod.cod_status AS ENUM (${COD_STATUSES.map((s) => `'${s}'`).join(', ')})`,
    );

    await r.query(`
      CREATE TABLE cod.records (
        id              uuid        PRIMARY KEY,
        shipment_id     uuid        NOT NULL,
        merchant_id     uuid        NOT NULL,
        expected_minor  bigint      NOT NULL CHECK (expected_minor > 0),
        collected_minor bigint      CHECK (collected_minor IS NULL OR collected_minor >= 0),
        currency        char(3)     NOT NULL,
        status          cod.cod_status NOT NULL,
        failure_note    text,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      )
    `);

    await r.query(`CREATE UNIQUE INDEX records_shipment_idx ON cod.records (shipment_id)`);
    await r.query(
      `CREATE INDEX records_merchant_created_idx ON cod.records (merchant_id, created_at DESC)`,
    );
    await r.query(
      `CREATE INDEX records_status_created_idx ON cod.records (status, created_at DESC)`,
    );
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS cod.records CASCADE`);
    await r.query(`DROP TYPE IF EXISTS cod.cod_status`);
  }
}
