import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `rider:sync` — the offline protocol's scope.
 *
 * The rider endpoints were guarded by `ApiKeyGuard` alone, so every one of them accepted any
 * authenticated principal. That included pulling and acknowledging a named rider's whole command
 * queue, which carries COD amounts, from a merchant's API key. The scope was missing rather than
 * merely unenforced: `API_SCOPES` had no `rider:*` entry for a guard to name.
 *
 * It is a **platform** scope, withheld from merchant roles by `PLATFORM_SCOPES` in roles.ts. A hub
 * is our network partner and a merchant is our client; neither is a tenant of the other, and this
 * one is squarely network.
 *
 * Postgres cannot drop an enum value, so `down` is a no-op. That is a property of the type system,
 * not a choice — see ADR-0012's note on the same asymmetry for the command vocabulary.
 */
export class RiderSyncScope1759000000042 implements MigrationInterface {
  name = 'RiderSyncScope1759000000042';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TYPE merchant.api_scope ADD VALUE IF NOT EXISTS 'rider:sync'`);
  }

  /** Intentionally empty: Postgres cannot remove an enum label without recreating the type. */
  public async down(): Promise<void> {
    // no-op
  }
}
