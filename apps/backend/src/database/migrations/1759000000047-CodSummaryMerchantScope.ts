import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `analytics.cod_summary` becomes merchant-scoped.
 *
 * It was keyed `(day, currency)` — network-wide with nowhere to put a merchant. Every event that
 * feeds it already carries `merchantId` in its payload (`CODCollected`, `CODPartialCollection` and
 * `SettlementCompleted` all do; the projection was dropping it), so this is a re-grain, not new
 * data collection. The consequence is that a merchant can finally read their OWN money: the
 * control-tower report answered "every merchant's COD in poisha" and there was no tenant-scoped
 * alternative to point them at.
 *
 * Re-grained rather than duplicated on purpose. A second per-merchant table beside the network one
 * would mean two tables that must agree about the same collections, and the network total would
 * stop being the sum of its parts — the disagreement would be invisible until someone added the two
 * numbers up. Summing the merchant rows reproduces the old network figure exactly.
 *
 * `delivery_success_rate` and `return_rate` are deliberately NOT touched. They feed only the
 * control tower, and their failure counts come from `DeliveryAttempted`, which carries no
 * `merchantId` (0 of 317 rows in the outbox have one) — re-graining them would either drop those
 * events or require a new payload field on a domain event that has no reason to know its merchant.
 * A merchant chart that cannot show delivery success rate says so; it does not invent the series.
 * `ponytail:` if a merchant-facing success rate is ever required, the honest route is adding
 * `merchantId` to the `DeliveryAttempted` payload (ShipmentLookup.findMerchantId already exists)
 * and re-graining both tables in one migration then — not half-doing it here.
 *
 * The 5 existing rows are network aggregates that cannot be attributed to a merchant, so they are
 * dropped rather than faked under some sentinel id. The rebuild replays the outbox and refills the
 * table from events that do carry the id.
 */
export class CodSummaryMerchantScope1759000000047 implements MigrationInterface {
  name = 'CodSummaryMerchantScope1759000000047';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS analytics.cod_summary`);
    await r.query(`
      CREATE TABLE analytics.cod_summary (
        merchant_id     uuid   NOT NULL,
        day             date   NOT NULL,
        currency        text   NOT NULL,
        expected_minor  bigint NOT NULL DEFAULT 0,
        collected_minor bigint NOT NULL DEFAULT 0,
        settled_minor   bigint NOT NULL DEFAULT 0,
        PRIMARY KEY (merchant_id, day, currency)
      )
    `);
    // The network report still reads this table across the whole range, so `day` leads.
    await r.query(`
      CREATE INDEX cod_summary_day_idx ON analytics.cod_summary (day)
    `);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS analytics.cod_summary`);
    await r.query(`
      CREATE TABLE analytics.cod_summary (
        day             date   NOT NULL,
        currency        text   NOT NULL,
        expected_minor  bigint NOT NULL DEFAULT 0,
        collected_minor bigint NOT NULL DEFAULT 0,
        settled_minor   bigint NOT NULL DEFAULT 0,
        PRIMARY KEY (day, currency)
      )
    `);
  }
}
