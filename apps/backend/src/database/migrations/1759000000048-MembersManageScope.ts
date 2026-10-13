import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `members:manage` — the scope that gates adding, changing and removing a membership.
 *
 * There was no write path for `identity.user_merchants` at all: `UserService` reads only, and every
 * membership in the database was written by the seed. Two things were broken by that, and the larger
 * one is not the one this scope fixes:
 *
 *  1. `MerchantAuthService.revokeSessionsForUser` had no caller. It was written and tested because
 *     `docs/api/auth.md` promises rotation on privilege change, and nothing in the API could change a
 *     privilege. It is wired up in the same change as this migration.
 *  2. A business with no way to remove a person cannot respond to someone leaving. That is the
 *     ordinary case this is for.
 *
 * Same shape as `0042-RiderSyncScope` and `0046-NetworkReadScope`: the scope was missing rather than
 * merely unenforced, so a guard had nothing to name.
 *
 * Postgres cannot drop an enum value, so `down` is a no-op. That is a property of the type system,
 * not a choice — see ADR-0012's note on the same asymmetry.
 */
export class MembersManageScope1759000000048 implements MigrationInterface {
  name = 'MembersManageScope1759000000048';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TYPE merchant.api_scope ADD VALUE IF NOT EXISTS 'members:manage'`);
  }

  /** Intentionally empty: Postgres cannot remove an enum label without recreating the type. */
  public async down(): Promise<void> {
    // no-op
  }
}
