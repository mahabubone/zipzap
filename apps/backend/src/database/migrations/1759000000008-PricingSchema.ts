/**
 * pricing.versions — the frozen rule table.
 *
 * One row per version, and a row is never updated in place: a price change is a new version plus
 * flipping `active`. That is the whole version-freeze guarantee, and it lives in the write
 * pattern, not in a trigger — versions are configuration, not history.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PricingSchema1759000000008 implements MigrationInterface {
  name = 'PricingSchema1759000000008';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE pricing.versions (
        version              integer     PRIMARY KEY,
        base_fee_minor       bigint      NOT NULL,
        per_kg_minor         bigint      NOT NULL,
        cod_fee_bps          integer     NOT NULL,
        remote_area_fee_minor bigint     NOT NULL,
        fragile_fee_minor    bigint      NOT NULL,
        packaging_fees_minor jsonb       NOT NULL DEFAULT '{}'::jsonb,
        tax_bps              integer     NOT NULL,
        plan_discount_bps    jsonb       NOT NULL DEFAULT '{}'::jsonb,
        currency             char(3)     NOT NULL,
        active               boolean     NOT NULL DEFAULT false,
        created_at           timestamptz NOT NULL DEFAULT now()
      )
    `);

    // The engine resolves the active version; the constraint keeps that unambiguous.
    await r.query(`
      CREATE UNIQUE INDEX pricing_versions_active_unique
        ON pricing.versions ((active IS TRUE))
        WHERE active IS TRUE
    `);

    // v1: the default table everything is quoted against until a contract says otherwise.
    // Minor units throughout — 6000 = ৳60.00 base, 2000 = ৳20.00 per kilo.
    await r.query(`
      INSERT INTO pricing.versions
        (version, base_fee_minor, per_kg_minor, cod_fee_bps, remote_area_fee_minor,
         fragile_fee_minor, packaging_fees_minor, tax_bps, plan_discount_bps, currency, active)
      VALUES
        (1, 6000, 2000, 180, 4000, 1500, '{"box_s": 800, "box_m": 1500}'::jsonb, 500,
         '{"standard": 0, "growth": 1000}'::jsonb, 'BDT', true)
    `);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS pricing.versions CASCADE`);
  }
}
