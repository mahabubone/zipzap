/**
 * Route → RouteLeg → Trip, manifests and their lifecycle (Phase 2 boxes,
 * Phase 5 rung 2b).
 *
 * Fixed topology first: two seeded line-haul routes, three legs each
 * (district → regional → regional → district), matching the documented
 * corridor pickup zone → origin → regional → destination → delivery point.
 *
 * Hub ids on legs are bare identifiers, not FKs — they point into `hub.hubs`
 * across a schema boundary (ADR-0002). Within-network references (leg → route,
 * manifest → trip, item → manifest) ARE FKs: one schema, one constraint.
 *
 * Manifest status is advanced by the domain transition in `rules/manifest.ts`
 * (lock → assert → save → outbox), never by a bare UPDATE. `manifest_items`
 * are append-only: a cargo list that can be edited after sealing is not
 * evidence of what left the hub.
 */

import { randomUUID } from 'node:crypto';
import type { MigrationInterface, QueryRunner } from 'typeorm';

interface RouteSeed {
  readonly code: string;
  readonly name: string;
  /** [from hub code, to hub code, mode] in sequence order. */
  readonly legs: ReadonlyArray<readonly [string, string, string]>;
}

const ROUTES: readonly RouteSeed[] = [
  {
    code: 'DAC-CGP-LH',
    name: 'Dhaka – Chattogram line-haul',
    legs: [
      ['DAC-D', 'DAC-R', 'LOCAL'],
      ['DAC-R', 'CGP-R', 'LINEHAUL'],
      ['CGP-R', 'CGP-D', 'LAST_MILE'],
    ],
  },
  {
    code: 'DAC-SYL-LH',
    name: 'Dhaka – Sylhet line-haul',
    legs: [
      ['DAC-D', 'DAC-R', 'LOCAL'],
      ['DAC-R', 'SYL-R', 'LINEHAUL'],
      ['SYL-R', 'SYL-D', 'LAST_MILE'],
    ],
  },
];

export class RouteManifestSchema1759000000026 implements MigrationInterface {
  name = 'RouteManifestSchema1759000000026';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE network.routes (
        id          uuid        PRIMARY KEY,
        code        text        NOT NULL UNIQUE,
        name        text        NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    await r.query(`
      CREATE TABLE network.route_legs (
        id            uuid        PRIMARY KEY,
        route_id      uuid        NOT NULL REFERENCES network.routes (id),
        sequence      integer     NOT NULL,
        from_hub_id   uuid        NOT NULL,
        to_hub_id     uuid        NOT NULL,
        mode          text        NOT NULL CHECK (mode IN ('LOCAL', 'LINEHAUL', 'LAST_MILE')),
        created_at    timestamptz NOT NULL DEFAULT now(),
        UNIQUE (route_id, sequence)
      )
    `);

    await r.query(`
      CREATE TABLE network.trips (
        id           uuid        PRIMARY KEY,
        route_id     uuid        NOT NULL REFERENCES network.routes (id),
        departed_at  timestamptz,
        arrived_at   timestamptz,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(`CREATE INDEX trips_route_idx ON network.trips (route_id)`);

    await r.query(`
      CREATE TABLE network.manifests (
        id          uuid        PRIMARY KEY,
        code        text        NOT NULL UNIQUE,
        trip_id     uuid        NOT NULL REFERENCES network.trips (id),
        status      text        NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'SEALED', 'DISPATCHED', 'RECEIVED', 'RECONCILED')),
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(`CREATE INDEX manifests_trip_idx ON network.manifests (trip_id)`);
    await r.query(`CREATE INDEX manifests_status_idx ON network.manifests (status)`);

    await r.query(`
      CREATE TABLE network.manifest_items (
        id            uuid        PRIMARY KEY,
        manifest_id   uuid        NOT NULL REFERENCES network.manifests (id),
        shipment_id   uuid        NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now(),
        UNIQUE (manifest_id, shipment_id)
      )
    `);
    await r.query(
      `CREATE INDEX manifest_items_shipment_idx ON network.manifest_items (shipment_id)`,
    );
    // Local function: a network table must not depend on a shipment-schema
    // trigger function (dropping it would break this table silently).
    await r.query(`
      CREATE OR REPLACE FUNCTION network.manifest_items_immutable()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'network.manifest_items is append-only: % is not permitted.', TG_OP
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql
    `);
    await r.query(`
      CREATE TRIGGER manifest_items_no_delete
        BEFORE DELETE ON network.manifest_items
        FOR EACH ROW EXECUTE FUNCTION network.manifest_items_immutable()
    `);

    const hubIds = new Map<string, string>();
    const hubs = (await r.query(`SELECT id, code FROM hub.hubs`)) as { id: string; code: string }[];
    for (const hub of hubs) hubIds.set(hub.code, hub.id);

    for (const route of ROUTES) {
      const routeId = randomUUID();
      await r.query(`INSERT INTO network.routes (id, code, name) VALUES ($1, $2, $3)`, [
        routeId,
        route.code,
        route.name,
      ]);
      let sequence = 1;
      for (const [from, to, mode] of route.legs) {
        const fromId = hubIds.get(from);
        const toId = hubIds.get(to);
        if (!fromId || !toId) throw new Error(`route ${route.code}: unknown hub ${from}/${to}`);
        await r.query(
          `INSERT INTO network.route_legs (id, route_id, sequence, from_hub_id, to_hub_id, mode)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), routeId, sequence, fromId, toId, mode],
        );
        sequence += 1;
      }
    }
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS network.manifest_items`);
    await r.query(`DROP FUNCTION IF EXISTS network.manifest_items_immutable()`);
    await r.query(`DROP TABLE IF EXISTS network.manifests`);
    await r.query(`DROP TABLE IF EXISTS network.trips`);
    await r.query(`DROP TABLE IF EXISTS network.route_legs`);
    await r.query(`DROP TABLE IF EXISTS network.routes`);
  }
}
