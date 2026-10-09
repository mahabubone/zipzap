import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `merchant.api_scope` learns `hub:read` and `hub:scan`.
 *
 * The scopes live in two places — `common/scopes.ts` and this enum — and the enum is what actually
 * refuses an unknown value. Code alone would let the seed advertise a scope no credential could
 * hold, and the failure would be a 500 at INSERT rather than a clear refusal at the boundary. This
 * is the migration that stops the two lists drifting.
 *
 * `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on PostgreSQL, so `down` is a
 * no-op with the reason recorded: `DROP VALUE` does not exist, and rebuilding the enum would fail
 * while issued credentials still hold these values. Removing a scope is a decision about live
 * credentials and belongs in its own reviewed migration.
 *
 * IF NOT EXISTS because `ADD VALUE` has been idempotent since PostgreSQL 9.3, and a re-run must not
 * fail on a value a previous run already added.
 */
export class HubScopes1759000000041 implements MigrationInterface {
  name = 'HubScopes1759000000041';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TYPE merchant.api_scope ADD VALUE IF NOT EXISTS 'hub:read'`);
    await r.query(`ALTER TYPE merchant.api_scope ADD VALUE IF NOT EXISTS 'hub:scan'`);
  }

  /** No-op. See the class comment — the enum cannot be reversed mechanically. */
  public async down(): Promise<void> {
    // Intentionally empty.
  }
}
