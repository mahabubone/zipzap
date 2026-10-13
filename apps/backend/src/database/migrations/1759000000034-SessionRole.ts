/**
 * Roles on sessions.
 *
 * Until now every human session was issued `[...API_SCOPES]` — all fifteen, including
 * `settlements:approve` and `keys:manage`. One shared merchant password meant one omnipotent
 * login per merchant, with no way to be anything less.
 *
 * The role lives on the SESSION, not on a user row, and that is a deliberate trade:
 *
 *   - a role change revokes the affected sessions, so the new permission set cannot be widened
 *     under a live token. Rotating on privilege change is a security property, not a convenience.
 *   - it needs no `identity.users` table, no user CRUD, and no admin surface to manage one.
 *
 * `ponytail:` the trade-off is that a role change forces a re-login. That is the correct failure
 * mode for an authorization change — worst case the operator logs in again. Add `identity.users`
 * when there is more than one human per merchant and the re-login stops being acceptable.
 *
 * A text column with a CHECK, not a Postgres enum: the role vocabulary is code
 * (identity/rules/roles.ts), and an enum would need a migration every time a role is added. The
 * CHECK keeps a bad value out without coupling the schema to the TypeScript.
 *
 * Existing rows default to MERCHANT_OWNER, which is exactly what they were — the merchant's own
 * login. This migration therefore narrows nothing for anyone already using the product.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SessionRole1759000000034 implements MigrationInterface {
  name = 'SessionRole1759000000034';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`
      ALTER TABLE merchant.sessions
        ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'MERCHANT_OWNER'
    `);
    await r.query(`
      ALTER TABLE merchant.sessions
        DROP CONSTRAINT IF EXISTS sessions_role_check
    `);
    await r.query(`
      ALTER TABLE merchant.sessions
        ADD CONSTRAINT sessions_role_check CHECK (role IN (
          'PLATFORM_ADMIN','OPERATIONS_MANAGER','HUB_OPERATOR','SUPPORT_AGENT',
          'MERCHANT_OWNER','MERCHANT_OPERATOR','RIDER'
        ))
    `);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TABLE merchant.sessions DROP CONSTRAINT IF EXISTS sessions_role_check`);
    await r.query(`ALTER TABLE merchant.sessions DROP COLUMN IF EXISTS role`);
  }
}
