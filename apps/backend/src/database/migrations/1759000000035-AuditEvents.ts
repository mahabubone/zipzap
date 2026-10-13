/**
 * `system.audit_events` — who did what, to which entity, from where.
 *
 * Lives in `system`, not `identity`, and that is the load-bearing decision. An audit row is written
 * by identity (a login), by merchant (an API key minted), by shipment (a hold released) and by
 * support (a customer record read). Putting the table in `identity` would make every other module
 * call identity to report what it did, which is coupling dressed as security. `system` is already
 * the documented home for cross-cutting mechanism — `outbox_events`, `idempotency_keys`,
 * `consumed_events` — and an audit trail is exactly that. Rule 2's exception, for the same reason
 * the outbox is: the mechanism must be reachable from everywhere.
 *
 * Append-only, enforced by TRIGGER for the same reason `tracking.events` is: `REVOKE` from the
 * table owner is a no-op in PostgreSQL (AGENTS.md rule 8 — audit rows are never updated or
 * deleted; a correction is a new row).
 *
 * `metadata` is jsonb and callers MUST NOT put a secret in it. Passwords, tokens and API secrets
 * are logged-and-stored nowhere (AGENTS.md rule 10); an audit row is a database row that outlives
 * every log retention policy, so it is the *last* place a secret should land, not the first.
 *
 * `request_id` is the join back to `docs/operations/observability.md`. It is the only correlation
 * key stored here — deliberately not a metric label.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AuditEvents1759000000035 implements MigrationInterface {
  name = 'AuditEvents1759000000035';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE IF NOT EXISTS system.audit_events (
        id           uuid PRIMARY KEY,
        occurred_at  timestamptz NOT NULL DEFAULT now(),
        -- WHO. 'human' | 'machine' | 'system'. Never a role name: roles change, the actor does not.
        actor_type   text NOT NULL,
        actor_id     text,
        -- Tenant scope, so a merchant-scoped read of the trail is a WHERE and not a JOIN.
        -- Nullable: a failed login has no authenticated actor, and platform actions have no merchant.
        merchant_id  uuid,
        -- WHAT. A past-tense dotted verb: auth.login.succeeded, credential.revoked,
        -- customer.record_read. Free text, because the set grows with the system.
        action       text NOT NULL,
        -- WHICH entity. (type, id) rather than a polymorphic FK — there is no table to point at.
        target_type  text,
        target_id    text,
        -- Correlates with the log line and the error envelope. See docs/operations/observability.md.
        request_id   text,
        -- Provenance: ip and user-agent. Enough to answer "who and from where" without storing a
        -- fingerprint.
        ip           text,
        user_agent   text,
        metadata     jsonb NOT NULL DEFAULT '{}'::jsonb
      )
    `);

    // Reads are always "what happened in this merchant's account", scoped and time-ordered.
    await r.query(`
      CREATE INDEX IF NOT EXISTS audit_events_merchant_time_idx
        ON system.audit_events (merchant_id, occurred_at DESC)
    `);
    await r.query(`
      CREATE INDEX IF NOT EXISTS audit_events_action_time_idx
        ON system.audit_events (action, occurred_at DESC)
    `);
    // Security review asks "show me everything this actor did" — that is the actor, newest first.
    await r.query(`
      CREATE INDEX IF NOT EXISTS audit_events_actor_time_idx
        ON system.audit_events (actor_id, occurred_at DESC)
    `);

    // Append-only, same trigger shape as tracking.events.
    await r.query(`
      CREATE OR REPLACE FUNCTION system.audit_events_are_immutable()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION
          'system.audit_events is append-only: % is not permitted. Record a correcting row instead.',
          TG_OP
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql
    `);
    await r.query(`
      CREATE TRIGGER audit_events_no_update
        BEFORE UPDATE ON system.audit_events
        FOR EACH ROW EXECUTE FUNCTION system.audit_events_are_immutable()
    `);
    await r.query(`
      CREATE TRIGGER audit_events_no_delete
        BEFORE DELETE ON system.audit_events
        FOR EACH ROW EXECUTE FUNCTION system.audit_events_are_immutable()
    `);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS system.audit_events CASCADE`);
    await r.query(`DROP FUNCTION IF EXISTS system.audit_events_are_immutable()`);
  }
}
