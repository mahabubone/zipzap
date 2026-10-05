/**
 * network.service_areas — coverage as data (Phase 2 box, Phase 5 rung 1).
 *
 * The rows ARE the serviceability answer: `serviceable`, `estimated_days`,
 * `pickup_available`, `delivery_available`, `cod_available`. No `if (city ===
 * 'Dhaka')` anywhere in code — if Dhaka stops being next-day that is a data
 * edit here, not a deploy (docs/domains/network.md).
 *
 * Absence of a row is also an answer: no coverage row = not serviceable, with
 * the zone name as the reason. The geometry columns arrive with routes (rung 2)
 * where a point is actually queried; a GIST index nobody queries is a write
 * tax. Seed: one row per division-capital metro, 1–3 day estimates.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

const COVERAGE = [
  // zone, estimated_days
  ['dhaka-metro', 1],
  ['chattogram-metro', 2],
  ['mymensingh-metro', 2],
  ['sylhet-metro', 3],
  ['khulna-metro', 3],
  ['rajshahi-metro', 3],
  ['barishal-metro', 3],
  ['rangpur-metro', 3],
] as const;

export class NetworkServiceAreas1759000000023 implements MigrationInterface {
  name = 'NetworkServiceAreas1759000000023';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE network.service_areas (
        zone                text        PRIMARY KEY,
        serviceable         boolean     NOT NULL,
        estimated_days      integer,
        pickup_available     boolean     NOT NULL,
        delivery_available   boolean     NOT NULL,
        cod_available        boolean     NOT NULL,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const [zone, days] of COVERAGE) {
      await r.query(
        `INSERT INTO network.service_areas
           (zone, serviceable, estimated_days, pickup_available, delivery_available, cod_available)
         VALUES ($1, true, $2, true, true, true)`,
        [zone, days],
      );
    }
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS network.service_areas`);
  }
}
