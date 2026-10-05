/**
 * Per-contract rate-limit override: `merchant.merchants.rate_limit_per_min`.
 *
 * The tier defaults are a floor for merchants with no contract value. A large
 * merchant is not malicious and must not be throttled like one sending 50
 * (docs/api/rate-limits.md). NULL means "use the tier default"; the CHECK
 * rejects nonsense at the database, the same trust-boundary rule as money.
 *
 * Additive and online-safe. down() drops the column: it is configuration, not
 * history — no ledger row or audit entry depends on it.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MerchantRateLimitOverride1759000000022 implements MigrationInterface {
  name = 'MerchantRateLimitOverride1759000000022';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`
      ALTER TABLE merchant.merchants
        ADD COLUMN rate_limit_per_min integer
        CHECK (rate_limit_per_min IS NULL OR rate_limit_per_min > 0)
    `);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TABLE merchant.merchants DROP COLUMN rate_limit_per_min`);
  }
}
