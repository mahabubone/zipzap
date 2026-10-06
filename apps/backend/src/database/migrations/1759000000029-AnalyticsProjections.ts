/**
 * Analytics projections (Phase 6 rung 3).
 *
 * Six read-only daily aggregates in the `analytics` schema, fed exclusively by the event
 * stream and rebuildable from `system.outbox_events` — see docs/domains/analytics.md.
 *
 * Deliberate shape choices:
 *
 *  - Integer counts and bigint minor units + currency, never floats and never money
 *    without its currency (AGENTS.md rules 4, docs/domains/analytics.md consistency).
 *  - Grain is (entity, day) with day resolved in Asia/Dhaka, not UTC: a Bangladesh
 *    business day is the axis every KPI in the domain doc is plotted on.
 *  - No foreign keys — the schema owns no authoritative data and crosses no boundary;
 *    ids are bare identifiers like everywhere else (docs/architecture/database.md).
 *  - The rate projections store counts, not computed ratios: `delivered / (delivered +
 *    failed)` is derived at read time so the stored numbers stay integers and the rate
 *    can never drift from its inputs.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AnalyticsProjections1759000000029 implements MigrationInterface {
  name = 'AnalyticsProjections1759000000029';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE IF NOT EXISTS analytics.merchant_daily_shipments (
        merchant_id       uuid   NOT NULL,
        day               date   NOT NULL,
        shipments_created integer NOT NULL DEFAULT 0,
        picked_up         integer NOT NULL DEFAULT 0,
        delivered         integer NOT NULL DEFAULT 0,
        PRIMARY KEY (merchant_id, day)
      )
    `);
    await r.query(`
      CREATE INDEX IF NOT EXISTS merchant_daily_shipments_day_idx
        ON analytics.merchant_daily_shipments (day)
    `);

    await r.query(`
      CREATE TABLE IF NOT EXISTS analytics.hub_daily_volume (
        hub_code text    NOT NULL,
        day      date    NOT NULL,
        scans    integer NOT NULL DEFAULT 0,
        PRIMARY KEY (hub_code, day)
      )
    `);
    await r.query(`
      CREATE INDEX IF NOT EXISTS hub_daily_volume_day_idx
        ON analytics.hub_daily_volume (day)
    `);

    await r.query(`
      CREATE TABLE IF NOT EXISTS analytics.rider_daily_performance (
        rider_id uuid    NOT NULL,
        day      date    NOT NULL,
        delivered integer NOT NULL DEFAULT 0,
        attempts  integer NOT NULL DEFAULT 0,
        failed    integer NOT NULL DEFAULT 0,
        PRIMARY KEY (rider_id, day)
      )
    `);
    await r.query(`
      CREATE INDEX IF NOT EXISTS rider_daily_performance_day_idx
        ON analytics.rider_daily_performance (day)
    `);

    // Counts only — the rate is computed at read time (see file header).
    await r.query(`
      CREATE TABLE IF NOT EXISTS analytics.delivery_success_rate (
        day       date PRIMARY KEY,
        delivered integer NOT NULL DEFAULT 0,
        failed    integer NOT NULL DEFAULT 0
      )
    `);

    await r.query(`
      CREATE TABLE IF NOT EXISTS analytics.return_rate (
        day      date PRIMARY KEY,
        delivered integer NOT NULL DEFAULT 0,
        returned  integer NOT NULL DEFAULT 0
      )
    `);

    await r.query(`
      CREATE TABLE IF NOT EXISTS analytics.cod_summary (
        day            date   NOT NULL,
        currency       text   NOT NULL,
        expected_minor bigint NOT NULL DEFAULT 0,
        collected_minor bigint NOT NULL DEFAULT 0,
        settled_minor  bigint NOT NULL DEFAULT 0,
        PRIMARY KEY (day, currency)
      )
    `);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS analytics.merchant_daily_shipments`);
    await r.query(`DROP TABLE IF EXISTS analytics.hub_daily_volume`);
    await r.query(`DROP TABLE IF EXISTS analytics.rider_daily_performance`);
    await r.query(`DROP TABLE IF EXISTS analytics.delivery_success_rate`);
    await r.query(`DROP TABLE IF EXISTS analytics.return_rate`);
    await r.query(`DROP TABLE IF EXISTS analytics.cod_summary`);
  }
}
