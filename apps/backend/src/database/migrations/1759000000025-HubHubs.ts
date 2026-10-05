/**
 * hub.hubs — where the network bends (Phase 5 rung 2b).
 *
 * A hub is a geo point: `location geography(Point, 4326)` with a GiST index,
 * same rules as the hierarchy boundary — metres, indexed from day one. The
 * `network_zone` column is a bare identifier pointing at
 * `network.service_areas.zone`: no cross-schema FK (ADR-0002).
 *
 * Seed: six hubs — district + regional for the Dhaka/Chattogram/Sylhet
 * corridors that rung 2b's route topology uses. Staff, capacity and schedules
 * arrive with the hub module's first real consumer.
 */

import { randomUUID } from 'node:crypto';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** code, name, kind, longitude, latitude, network zone */
const HUBS: ReadonlyArray<readonly [string, string, string, number, number, string]> = [
  ['DAC-D', 'Dhaka District Hub', 'DISTRICT_HUB', 90.405, 23.75, 'dhaka-metro'],
  ['DAC-R', 'Dhaka Regional Hub', 'REGIONAL_HUB', 90.4125, 23.8103, 'dhaka-metro'],
  ['CGP-R', 'Chattogram Regional Hub', 'REGIONAL_HUB', 91.8317, 22.368, 'chattogram-metro'],
  ['CGP-D', 'Chattogram District Hub', 'DISTRICT_HUB', 91.81, 22.34, 'chattogram-metro'],
  ['SYL-R', 'Sylhet Regional Hub', 'REGIONAL_HUB', 91.869, 24.89, 'sylhet-metro'],
  ['SYL-D', 'Sylhet District Hub', 'DISTRICT_HUB', 91.85, 24.88, 'sylhet-metro'],
];

export class HubHubs1759000000025 implements MigrationInterface {
  name = 'HubHubs1759000000025';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE EXTENSION IF NOT EXISTS postgis`);

    await r.query(`
      CREATE TABLE hub.hubs (
        id            uuid        PRIMARY KEY,
        code          text        NOT NULL UNIQUE,
        name          text        NOT NULL,
        kind          text        NOT NULL CHECK (
                      kind IN ('REGIONAL_HUB', 'DISTRICT_HUB', 'LOCAL_HUB', 'DELIVERY_POINT')),
        location      geography(Point, 4326),
        network_zone  text,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(`CREATE INDEX hubs_location_gist_idx ON hub.hubs USING GIST (location)`);
    await r.query(`CREATE INDEX hubs_kind_idx ON hub.hubs (kind)`);

    for (const [code, name, kind, lng, lat, zone] of HUBS) {
      await r.query(
        `INSERT INTO hub.hubs (id, code, name, kind, location, network_zone)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_Point($5, $6), 4326)::geography, $7)`,
        [randomUUID(), code, name, kind, lng, lat, zone],
      );
    }
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS hub.hubs`);
  }
}
