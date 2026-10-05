/**
 * network.geo_areas — the Bangladesh hierarchy (Phase 2 box, Phase 5 rung 2).
 *
 * division → district → upazila → union → ward → delivery point, as rows:
 * self-parented within `network`, kinds closed by CHECK. Seed: 8 divisions,
 * all 64 districts (real names, correctly parented), 20 sample upazilas —
 * union/ward/delivery-point rows arrive when geocoding produces them.
 *
 * `boundary geography(MultiPolygon, 4326)`, never `geometry`: metres, not
 * coordinate units, and a GiST index from day one so the first spatial query
 * is not a seq scan. Boundaries stay NULL until real boundary data is
 * imported — an invented polygon is a confidently wrong service area.
 */

import { randomUUID } from 'node:crypto';
import type { MigrationInterface, QueryRunner } from 'typeorm';

const DIVISIONS: Readonly<Record<string, readonly string[]>> = {
  Barishal: ['Barishal', 'Barguna', 'Bhola', 'Jhalokati', 'Patuakhali', 'Pirojpur'],
  Chattogram: [
    'Bandarban',
    'Brahmanbaria',
    'Chandpur',
    'Chattogram',
    "Cox's Bazar",
    'Cumilla',
    'Feni',
    'Khagrachhari',
    'Lakshmipur',
    'Noakhali',
    'Rangamati',
  ],
  Dhaka: [
    'Dhaka',
    'Faridpur',
    'Gazipur',
    'Gopalganj',
    'Kishoreganj',
    'Madaripur',
    'Manikganj',
    'Munshiganj',
    'Narayanganj',
    'Narsingdi',
    'Rajbari',
    'Shariatpur',
    'Tangail',
  ],
  Khulna: [
    'Bagerhat',
    'Chuadanga',
    'Jashore',
    'Jhenaidah',
    'Khulna',
    'Kushtia',
    'Magura',
    'Meherpur',
    'Narail',
    'Satkhira',
  ],
  Mymensingh: ['Jamalpur', 'Mymensingh', 'Netrokona', 'Sherpur'],
  Rajshahi: [
    'Bogura',
    'Chapainawabganj',
    'Joypurhat',
    'Naogaon',
    'Natore',
    'Pabna',
    'Rajshahi',
    'Sirajganj',
  ],
  Rangpur: [
    'Dinajpur',
    'Gaibandha',
    'Kurigram',
    'Lalmonirhat',
    'Nilphamari',
    'Panchagarh',
    'Rangpur',
    'Thakurgaon',
  ],
  Sylhet: ['Habiganj', 'Moulvibazar', 'Sunamganj', 'Sylhet'],
};

/** Sample upazilas, parented by exact district name from the table above. */
const UPAZILAS: ReadonlyArray<readonly [district: string, name: string]> = [
  ['Dhaka', 'Savar'],
  ['Dhaka', 'Dhamrai'],
  ['Dhaka', 'Dohar'],
  ['Dhaka', 'Keraniganj'],
  ['Dhaka', 'Nawabganj'],
  ['Chattogram', 'Sitakunda'],
  ['Chattogram', 'Hathazari'],
  ['Chattogram', 'Rangunia'],
  ['Chattogram', 'Patiya'],
  ['Chattogram', 'Anwara'],
  ['Sylhet', 'Balaganj'],
  ['Sylhet', 'Beanibazar'],
  ['Sylhet', 'Bishwanath'],
  ['Sylhet', 'Companiganj'],
  ['Sylhet', 'Fenchuganj'],
  ['Cumilla', 'Debidwar'],
  ['Cumilla', 'Barura'],
  ['Cumilla', 'Brahmanpara'],
  ['Cumilla', 'Burichang'],
  ['Cumilla', 'Chandina'],
];

export class GeoHierarchy1759000000024 implements MigrationInterface {
  name = 'GeoHierarchy1759000000024';

  public async up(r: QueryRunner): Promise<void> {
    // Idempotent: the extension is what makes `geography` a type at all.
    await r.query(`CREATE EXTENSION IF NOT EXISTS postgis`);

    await r.query(`
      CREATE TABLE network.geo_areas (
        id          uuid        PRIMARY KEY,
        kind        text        NOT NULL CHECK (
                    kind IN ('division', 'district', 'upazila', 'union', 'ward', 'delivery_point')),
        name        text        NOT NULL,
        parent_id   uuid        REFERENCES network.geo_areas (id),
        boundary    geography(MultiPolygon, 4326),
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await r.query(`CREATE INDEX geo_areas_parent_idx ON network.geo_areas (parent_id)`);
    await r.query(
      `CREATE UNIQUE INDEX geo_areas_kind_name_parent_idx ON network.geo_areas (kind, name, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid))`,
    );
    await r.query(
      `CREATE INDEX geo_areas_boundary_gist_idx ON network.geo_areas USING GIST (boundary)`,
    );

    const divisionIds = new Map<string, string>();
    for (const [division, districts] of Object.entries(DIVISIONS)) {
      const divisionId = randomUUID();
      divisionIds.set(division, divisionId);
      await r.query(
        `INSERT INTO network.geo_areas (id, kind, name, parent_id) VALUES ($1, 'division', $2, NULL)`,
        [divisionId, division],
      );
      for (const district of districts) {
        await r.query(
          `INSERT INTO network.geo_areas (id, kind, name, parent_id) VALUES ($1, 'district', $2, $3)`,
          [randomUUID(), district, divisionId],
        );
      }
    }

    const districtIds = new Map<string, string>();
    const districts = await r.query(
      `SELECT id, name FROM network.geo_areas WHERE kind = 'district'`,
    );
    for (const row of districts as { id: string; name: string }[]) {
      districtIds.set(row.name, row.id);
    }
    for (const [district, upazila] of UPAZILAS) {
      const parentId = districtIds.get(district);
      if (!parentId) throw new Error(`seed references unknown district "${district}"`);
      await r.query(
        `INSERT INTO network.geo_areas (id, kind, name, parent_id) VALUES ($1, 'upazila', $2, $3)`,
        [randomUUID(), upazila, parentId],
      );
    }
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS network.geo_areas`);
  }
}
