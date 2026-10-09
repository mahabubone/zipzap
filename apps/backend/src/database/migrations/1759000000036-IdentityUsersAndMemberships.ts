/**
 * A principal that is not the merchant: `identity.users` + `identity.user_merchants`.
 *
 * Until now a login WAS a merchant. `merchant.merchants.contact_email` + `password_hash` were the
 * credential, `merchant.sessions` carried a `merchant_id`, and the role lived on the session. That
 * works for exactly one human per merchant, and it is why the Stage 0 exit check's multi-business
 * assertion could not pass: the second business was unrepresentable, not unimplemented.
 *
 * Three changes, in one migration because they are one change:
 *
 *  1. `identity.users` — one row per PERSON. Owns the password hash. A person is not a tenant, so
 *     the credential that proves who you are stops being the thing that scopes what you can see.
 *  2. `identity.user_merchants` — the membership. `role` lives HERE, per membership, not on the
 *     user: an operator at one store and an owner at another is a real case, and a role on the
 *     user cannot express it. This replaces the session's `role` column (migration 0034), whose
 *     ponytail note named this table as the condition for its own removal.
 *  3. `merchant.sessions.user_id` — a session authenticates a USER. It keeps `merchant_id` as the
 *     ACTIVE business, because that is what every one of the 18 `principal.merchantId` call sites
 *     reads; it is a selection within a membership set, not the tenancy boundary itself.
 *
 * ## Boundary note — identity now owns tables
 *
 * identity registered NO TypeORM connection until now (see identity.module.ts). It owns two tables
 * and therefore owns a connection. This is the boundary rule moving in the correct direction: the
 * alternative was leaving a person's credential inside `merchant` forever, which is what made
 * "one login, many businesses" impossible to express.
 *
 * ## Backfill
 *
 * Every existing merchant with a password becomes one user with one MERCHANT_OWNER membership, so
 * nobody loses access and every seeded console login keeps working. Merchants are the unit here
 * because there is no person-shaped data yet to migrate — there is exactly one login per merchant
 * in every existing row, and inventing a shared person across them would fabricate memberships
 * nobody asserted.
 *
 * `sessions.role` and `merchants.password_hash` are DROPPED, not nulled: both are now readable
 * from a source of truth, and leaving a second copy of a credential in the database is the exact
 * failure this migration exists to remove. Sessions keep `merchant_id` — see (3).
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class IdentityUsersAndMemberships1759000000036 implements MigrationInterface {
  name = 'IdentityUsersAndMemberships1759000000036';

  public async up(r: QueryRunner): Promise<void> {
    // --- identity.users — the person ------------------------------------------------
    await r.query(`
      CREATE TABLE IF NOT EXISTS identity.users (
        id             uuid PRIMARY KEY,
        -- The login identity. Lower-cased and unique: two people must not be one login, and
        -- 'A@b' and 'a@b' failing to be distinct accounts is a support ticket nobody enjoys.
        email          text NOT NULL,
        -- scrypt, versioned. Moved off merchant.merchants because a password belongs to a person.
        password_hash  text NOT NULL,
        display_name   text,
        -- A person is ACTIVE or not. Suspension is a merchant decision (merchant.merchants.status)
        -- and is deliberately NOT modelled here: one suspended merchant must not lock a person out
        -- of every other business they belong to.
        disabled_at    timestamptz,
        created_at     timestamptz NOT NULL DEFAULT now(),
        updated_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT users_email_unique UNIQUE (email)
      )
    `);
    await r.query(`
      CREATE INDEX IF NOT EXISTS users_email_lower_idx ON identity.users (lower(email))
    `);

    // --- identity.user_merchants — the membership, and where the role lives ---------
    await r.query(`
      CREATE TABLE IF NOT EXISTS identity.user_merchants (
        user_id      uuid NOT NULL,
        -- A bare identifier, NOT a foreign key: merchant is another module's table (ADR-0002).
        -- The CHECK below is what actually protects this column, and it is the same vocabulary
        -- identity/rules/roles.ts defines.
        merchant_id  uuid NOT NULL,
        -- Per membership, not per user. This is the change that makes "operator at store A, owner
        -- at store B" expressible.
        role         text NOT NULL DEFAULT 'MERCHANT_OPERATOR',
        created_at   timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, merchant_id),
        CONSTRAINT user_merchants_role_check CHECK (role IN (
          'PLATFORM_ADMIN','OPERATIONS_MANAGER','HUB_OPERATOR','SUPPORT_AGENT',
          'MERCHANT_OWNER','MERCHANT_OPERATOR','RIDER'
        ))
      )
    `);
    await r.query(`
      CREATE INDEX IF NOT EXISTS user_merchants_merchant_idx
        ON identity.user_merchants (merchant_id)
    `);

    // --- sessions now authenticate a user ------------------------------------------
    await r.query(`ALTER TABLE merchant.sessions ADD COLUMN IF NOT EXISTS user_id uuid`);

    // --- backfill: one merchant with a password becomes one user + one membership ----
    // Every existing login was the merchant's own, so MERCHANT_OWNER is the honest role: it is
    // exactly what migration 0034 gave those sessions by default.
    await r.query(`
      INSERT INTO identity.users (id, email, password_hash)
      SELECT gen_random_uuid(), lower(m.contact_email), m.password_hash
        FROM merchant.merchants m
       WHERE m.password_hash IS NOT NULL
         AND lower(m.contact_email) NOT IN (SELECT lower(email) FROM identity.users)
    `);
    await r.query(`
      INSERT INTO identity.user_merchants (user_id, merchant_id, role)
      SELECT u.id, m.id, 'MERCHANT_OWNER'
        FROM merchant.merchants m
        JOIN identity.users u ON lower(u.email) = lower(m.contact_email)
       WHERE m.password_hash IS NOT NULL
         ON CONFLICT (user_id, merchant_id) DO NOTHING
    `);
    await r.query(`
      UPDATE merchant.sessions s
         SET user_id = u.id
        FROM merchant.merchants m, identity.users u
       WHERE s.user_id IS NULL
         AND m.id = s.merchant_id
         AND lower(u.email) = lower(m.contact_email)
    `);

    // --- drop what now has a source of truth ---------------------------------------
    // `sessions.role`: superseded by the membership's role. A session that carried its own copy
    // could disagree with the membership and nothing would notice.
    await r.query(`ALTER TABLE merchant.sessions DROP CONSTRAINT IF EXISTS sessions_role_check`);
    await r.query(`ALTER TABLE merchant.sessions DROP COLUMN IF EXISTS role`);
    // `merchants.password_hash`: the credential moved to the person. Two copies of a password hash
    // is one more thing to rotate and one more place to leak from.
    await r.query(`ALTER TABLE merchant.merchants DROP COLUMN IF EXISTS password_hash`);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TABLE merchant.merchants ADD COLUMN IF NOT EXISTS password_hash text`);
    await r.query(`ALTER TABLE merchant.sessions ADD COLUMN IF NOT EXISTS role text`);
    // Sessions outlive the migration, so restore the role they were issued with. The membership is
    // the better source; a session row is the only place that still knows which one it was.
    await r.query(`
      UPDATE merchant.sessions s
         SET role = um.role
        FROM identity.user_merchants um
       WHERE um.user_id = s.user_id AND um.merchant_id = s.merchant_id
    `);
    await r.query(`
      UPDATE merchant.sessions SET role = 'MERCHANT_OWNER' WHERE role IS NULL
    `);
    await r.query(`
      ALTER TABLE merchant.sessions
        ADD CONSTRAINT sessions_role_check CHECK (role IN (
          'PLATFORM_ADMIN','OPERATIONS_MANAGER','HUB_OPERATOR','SUPPORT_AGENT',
          'MERCHANT_OWNER','MERCHANT_OPERATOR','RIDER'
        ))
    `);
    await r.query(`
      UPDATE merchant.merchants m
         SET password_hash = u.password_hash
        FROM identity.users u
       WHERE lower(u.email) = lower(m.contact_email)
    `);
    await r.query(`ALTER TABLE merchant.sessions DROP COLUMN IF EXISTS user_id`);
    await r.query(`DROP TABLE IF EXISTS identity.user_merchants`);
    await r.query(`DROP TABLE IF EXISTS identity.users`);
  }
}
