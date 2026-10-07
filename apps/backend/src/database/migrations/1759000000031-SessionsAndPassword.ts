/**
 * Human login: sessions table + password hash on merchants.
 *
 * `merchants.password_hash` is nullable because credentials merchants created
 * today may never log in; a NULL means no password path, and login with a
 * password for such a merchant is simply denied. `merchant.sessions` stores
 * only the SHA-256 of the bearer token — the raw token leaves the login
 * response exactly once and is never recoverable.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SessionsAndPassword1759000000031 implements MigrationInterface {
  name = 'SessionsAndPassword1759000000031';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TABLE merchant.merchants ADD COLUMN IF NOT EXISTS password_hash text`);
    await r.query(`
      CREATE TABLE IF NOT EXISTS merchant.sessions (
        id          uuid PRIMARY KEY,
        merchant_id uuid NOT NULL REFERENCES merchant.merchants(id),
        token_hash  text NOT NULL UNIQUE,
        created_at  timestamptz NOT NULL DEFAULT now(),
        expires_at  timestamptz NOT NULL,
        revoked_at  timestamptz
      )
    `);
    await r.query(
      `CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON merchant.sessions (token_hash)`,
    );
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS merchant.sessions`);
    await r.query(`ALTER TABLE merchant.merchants DROP COLUMN IF EXISTS password_hash`);
  }
}
