/**
 * Add the `keys:manage` scope to merchant.api_scope.
 *
 * `common/scopes.ts` listed `keys:manage` from the start, but migration 0004
 * seeds the Postgres enum from that same array — so the value existed in the
 * type before any migration taught the database about it. Seeding a merchant
 * with the full scope list then failed with
 * `invalid input value for enum merchant.api_scope: "keys:manage"`.
 *
 * Same ALTER TYPE pattern as 0011/0020/0030/0032: additive, online-safe, and
 * the down migration is a no-op because enum values are append-only history.
 * Rule 5 — this is a new migration, not an edit to 0004.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKeysManageScope1759000000033 implements MigrationInterface {
  name = 'AddKeysManageScope1759000000033';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TYPE merchant.api_scope ADD VALUE IF NOT EXISTS 'keys:manage'`);
  }

  public async down(): Promise<void> {
    // Enum values cannot be removed portably.
  }
}
