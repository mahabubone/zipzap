/**
 * `merchant.merchants.plan` — the pricing plan this merchant is on.
 *
 * **This closes a real hole, not a symmetry gap.** `POST /v1/pricing/quote` takes `merchantPlan` in
 * the request body and discounts by it. With nothing on the merchant record, any caller could send
 * `"growth"` and be quoted the 1000 bps discount they had not earned — a merchant quietly costing
 * themselves 10% of every delivery fee, and a number nobody could explain afterwards because the
 * server never knew which plan applied.
 *
 * `standard` is the default and the backfill value. Every existing merchant genuinely is on standard
 * until somebody changes it: the seeded pricing version gives `standard` a 0 bps discount, so the
 * backfill cannot change anyone's price, and a NULL here would mean "unknown" in a column that
 * decides money.
 *
 * Not an enum, for the same reason `shipment.zone` is not: plans are commercial configuration that
 * grows, and a quote frozen against `pricing_version` must stay readable after a plan is renamed. A
 * `CHECK` against a live list would make old quotes unexplainable the day a plan is retired.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MerchantPlan1759000000039 implements MigrationInterface {
  name = 'MerchantPlan1759000000039';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(
      `ALTER TABLE merchant.merchants
         ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'standard'`,
    );
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TABLE merchant.merchants DROP COLUMN IF EXISTS plan`);
  }
}
