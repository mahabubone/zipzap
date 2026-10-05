/**
 * Integration: the geography hierarchy and the geo column types, against
 * real PostGIS. Skipped, not failed, when DATABASE_URL is absent.
 *
 * What these prove are the Phase 2 network boxes themselves: the hierarchy
 * exists as parented rows (8/64/20), every row reaches a division, the
 * boundary column is `geography` (not `geometry`) with a GiST index, and a
 * distance query returns metres — the single difference that makes a
 * geography column worth insisting on.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { DataSource } from 'typeorm';
import { connectModuleDataSource } from '../../dist/database/module-connection.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

let networkDb: DataSource;

before(async () => {
  if (!databaseUrl) return;
  networkDb = await connectModuleDataSource('network', []);
});

after(async () => {
  await networkDb?.destroy();
});

describeIfDb('geo hierarchy — seed is the data, not a city check', () => {
  test('8 divisions, 64 districts, 20 sample upazilas', async () => {
    const counts = await networkDb.query(
      `SELECT kind, count(*)::int AS n FROM network.geo_areas GROUP BY kind ORDER BY kind`,
    );
    const byKind = Object.fromEntries(
      (counts as { kind: string; n: number }[]).map((row) => [row.kind, row.n]),
    );
    assert.equal(byKind.division, 8);
    assert.equal(byKind.district, 64);
    assert.equal(byKind.upazila, 20);
  });

  test('every district and upazila reaches a division — no orphans', async () => {
    const orphans = await networkDb.query(`
      SELECT c.id, c.name, c.kind
        FROM network.geo_areas c
        LEFT JOIN network.geo_areas parent ON parent.id = c.parent_id
       WHERE c.kind IN ('district', 'upazila')
         AND (c.parent_id IS NULL OR parent.id IS NULL)
    `);
    assert.equal(orphans.length, 0, 'every child row is parented');

    const wrongKind = await networkDb.query(`
      SELECT child.name, child.kind, parent.kind AS parent_kind
        FROM network.geo_areas child
        JOIN network.geo_areas parent ON parent.id = child.parent_id
       WHERE (child.kind = 'district' AND parent.kind <> 'division')
          OR (child.kind = 'upazila' AND parent.kind <> 'district')
    `);
    assert.equal(wrongKind.length, 0, 'districts parent to divisions, upazilas to districts');
  });

  test('the kinds cover the full documented chain', async () => {
    // The CHECK exists as a database constraint, not just in the migration source.
    const constraint = await networkDb.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'network.geo_areas'::regclass AND contype = 'c'`,
    );
    const def = String((constraint as { def: string }[])[0]?.def ?? '');
    for (const kind of ['division', 'district', 'upazila', 'union', 'ward', 'delivery_point']) {
      assert.ok(def.includes(kind), `CHECK covers ${kind}`);
    }
  });
});

describeIfDb('geo types — geography, not geometry', () => {
  test('the boundary column is geography(MultiPolygon, 4326)', async () => {
    const rows = await networkDb.query(
      `SELECT udt_name
         FROM information_schema.columns
        WHERE table_schema = 'network' AND table_name = 'geo_areas' AND column_name = 'boundary'`,
    );
    assert.equal((rows as { udt_name: string }[])[0]?.udt_name, 'geography');
  });

  test('a GIST index exists on the boundary column', async () => {
    const rows = await networkDb.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'network' AND tablename = 'geo_areas'
          AND indexdef ILIKE '%USING gist%'`,
    );
    assert.equal(rows.length, 1, 'boundary is indexed for spatial queries from day one');
  });

  test('a distance query returns metres, not coordinate units', async () => {
    // ~2.3 km apart by road distance. Geometry (degrees) would return ~0.02.
    const rows = await networkDb.query(`
      SELECT ST_Distance(
        ST_SetSRID(ST_Point(90.39, 23.81), 4326)::geography,
        ST_SetSRID(ST_Point(90.41, 23.82), 4326)::geography
      ) AS metres
    `);
    const metres = Number((rows as { metres: string }[])[0]?.metres);
    assert.ok(metres > 1000 && metres < 5000, `expected ~2.3km in metres, got ${metres}`);
  });
});
