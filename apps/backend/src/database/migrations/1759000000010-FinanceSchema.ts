/**
 * finance.ledger_entries + finance.settlements — the append-only money tables.
 *
 * Two invariants, enforced at the database because application code is bypassable and the
 * table owner always retains every privilege (REVOKE from an owner is a no-op in PostgreSQL,
 * verified against a live database — see migration 0002):
 *
 *  1. ledger_entries is append-only. A trigger rejects UPDATE and DELETE outright. Corrections
 *     are compensating entries: the wrong row stays visible, a new row explains it.
 *  2. settlements rows may only move forward. A second trigger rejects any status change that
 *     is not in the CREATED -> APPROVED -> PAYMENT_INITIATED -> PAYMENT_CONFIRMED -> SETTLED
 *     chain, and rejects any change to items_json or frozen_net_minor once APPROVED.
 *     An approved settlement is a contract; it must be uneditable even by hand.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';
import { LEDGER_ENTRY_TYPES, SETTLEMENT_STATUSES } from '../../modules/finance/rules/finance.ts';

export class FinanceSchema1759000000010 implements MigrationInterface {
  name = 'FinanceSchema1759000000010';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TYPE merchant.api_scope ADD VALUE IF NOT EXISTS 'settlements:approve'`);

    await r.query(
      `CREATE TYPE finance.ledger_entry_type AS ENUM (${LEDGER_ENTRY_TYPES.map((t) => `'${t}'`).join(', ')})`,
    );
    await r.query(
      `CREATE TYPE finance.settlement_status AS ENUM (${SETTLEMENT_STATUSES.map((s) => `'${s}'`).join(', ')})`,
    );

    await r.query(`
      CREATE TABLE finance.ledger_entries (
        id              uuid        PRIMARY KEY,
        merchant_id     uuid        NOT NULL,
        entry_type      finance.ledger_entry_type NOT NULL,
        direction       smallint    NOT NULL CHECK (direction IN (1, -1)),
        amount_minor    bigint      NOT NULL CHECK (amount_minor > 0),
        currency        char(3)     NOT NULL,
        reference_type  text        NOT NULL,
        reference_id    uuid        NOT NULL,
        memo            text,
        occurred_at     timestamptz NOT NULL,
        recorded_at     timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(
      `CREATE INDEX ledger_entries_merchant_recorded_idx ON finance.ledger_entries (merchant_id, recorded_at DESC)`,
    );
    await r.query(
      `CREATE INDEX ledger_entries_reference_idx ON finance.ledger_entries (reference_type, reference_id)`,
    );

    // Append-only, enforced by trigger: REVOKE from the owner does nothing in PostgreSQL.
    await r.query(`
      CREATE OR REPLACE FUNCTION finance.ledger_entries_are_immutable()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION
          'finance.ledger_entries is append-only: % is not permitted. Post a compensating entry instead.',
          TG_OP
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql
    `);
    await r.query(`
      CREATE TRIGGER ledger_entries_no_update
        BEFORE UPDATE ON finance.ledger_entries
        FOR EACH ROW EXECUTE FUNCTION finance.ledger_entries_are_immutable()
    `);
    await r.query(`
      CREATE TRIGGER ledger_entries_no_delete
        BEFORE DELETE ON finance.ledger_entries
        FOR EACH ROW EXECUTE FUNCTION finance.ledger_entries_are_immutable()
    `);

    await r.query(`
      CREATE TABLE finance.settlements (
        id               uuid        PRIMARY KEY,
        reference        text        NOT NULL,
        merchant_id      uuid        NOT NULL,
        status           finance.settlement_status NOT NULL,
        items_json       jsonb       NOT NULL,
        frozen_net_minor bigint      NOT NULL,
        currency         char(3)     NOT NULL,
        approved_by      uuid,
        approved_at      timestamptz,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(
      `CREATE UNIQUE INDEX settlements_reference_idx ON finance.settlements (reference)`,
    );
    await r.query(
      `CREATE INDEX settlements_merchant_created_idx ON finance.settlements (merchant_id, created_at DESC)`,
    );
    await r.query(
      `CREATE INDEX settlements_status_created_idx ON finance.settlements (status, created_at DESC)`,
    );

    // A settlement may only move forward, and its frozen snapshot is untouchable once approved.
    await r.query(`
      CREATE OR REPLACE FUNCTION finance.settlements_guard_transition()
      RETURNS trigger AS $$
      DECLARE
        allowed boolean;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'finance.settlements cannot be deleted.'
            USING ERRCODE = 'restrict_violation';
        END IF;

        allowed := CASE OLD.status::text
          WHEN 'CREATED' THEN NEW.status::text = 'APPROVED'
          WHEN 'APPROVED' THEN NEW.status::text = 'PAYMENT_INITIATED'
          WHEN 'PAYMENT_INITIATED' THEN NEW.status::text = 'PAYMENT_CONFIRMED'
          WHEN 'PAYMENT_CONFIRMED' THEN NEW.status::text = 'SETTLED'
          ELSE false
        END;

        IF NOT allowed THEN
          RAISE EXCEPTION 'Illegal settlement transition % -> %.', OLD.status, NEW.status
            USING ERRCODE = 'restrict_violation';
        END IF;

        IF OLD.status::text <> 'CREATED'
          AND (NEW.items_json IS DISTINCT FROM OLD.items_json
            OR NEW.frozen_net_minor IS DISTINCT FROM OLD.frozen_net_minor) THEN
          RAISE EXCEPTION 'An approved settlement is immutable: items and net cannot change.'
            USING ERRCODE = 'restrict_violation';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await r.query(`
      CREATE TRIGGER settlements_no_delete
        BEFORE DELETE ON finance.settlements
        FOR EACH ROW EXECUTE FUNCTION finance.settlements_guard_transition()
    `);
    await r.query(`
      CREATE TRIGGER settlements_guard_update
        BEFORE UPDATE ON finance.settlements
        FOR EACH ROW EXECUTE FUNCTION finance.settlements_guard_transition()
    `);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS finance.settlements CASCADE`);
    await r.query(`DROP FUNCTION IF EXISTS finance.settlements_guard_transition()`);
    await r.query(`DROP TABLE IF EXISTS finance.ledger_entries CASCADE`);
    await r.query(`DROP FUNCTION IF EXISTS finance.ledger_entries_are_immutable()`);
    await r.query(`DROP TYPE IF EXISTS finance.settlement_status`);
    await r.query(`DROP TYPE IF EXISTS finance.ledger_entry_type`);
  }
}
