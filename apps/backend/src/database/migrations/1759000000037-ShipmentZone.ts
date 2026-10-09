/**
 * `shipment.shipments.zone` — the destination zone a parcel was priced for.
 *
 * Added for the list filter, and it closes a real gap rather than adding a
 * column for symmetry: `zone`, `remote_area` and `fragile` were accepted by
 * `POST /v1/shipments`, used to check serviceability and to compute the quote,
 * and then **discarded**. A parcel created for `chattogram-metro` was
 * indistinguishable from one for `sylhet-metro` afterwards — including in the
 * price the merchant was charged, and including in any dispute about it. The
 * quote is frozen in `pricing_version` but its inputs were not, so a charge
 * could not be explained after the fact.
 *
 * `zone` is the one that earns its column here: it is the filter the console
 * needs, and it is the input a merchant most often wants to see next to the
 * amount. `remote_area` and `fragile` are priced the same way and are left
 * out deliberately — no screen reads them yet, and an unindexed nullable
 * boolean nobody queries is a column that costs on every write.
 *
 * `text`, not an enum and not a foreign key to `network.service_areas`: the
 * zones are network configuration (another module's schema, rule 2), the set
 * grows, and a parcel must keep naming the zone it was priced against even if
 * that zone is later renamed. A `CHECK` against a live list would make old
 * parcels unreadable the moment a zone is retired.
 *
 * Nullable and backfilled NULL: existing rows genuinely do not know their zone,
 * and inventing one would be a lie in a financial column. A filter on `zone`
 * therefore excludes pre-existing rows, which is the honest answer.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ShipmentZone1759000000037 implements MigrationInterface {
  name = 'ShipmentZone1759000000037';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TABLE shipment.shipments ADD COLUMN IF NOT EXISTS zone text`);
    // Partial: most parcels are not filtered by zone, and an index that includes
    // every NULL row is larger than it needs to be for no gain.
    await r.query(`
      CREATE INDEX IF NOT EXISTS shipments_merchant_zone_created_idx
        ON shipment.shipments (merchant_id, zone, created_at DESC)
        WHERE zone IS NOT NULL
    `);

    // The search filter is `ILIKE '%term%'`, and a leading wildcard cannot use a
    // btree — so this is a trigram GIN index or it is a sequential scan.
    //
    // BOTH extensions are created here, inside the migration, BEFORE the index.
    // `btree_gin` is not optional: a composite GIN needs an operator class for
    // every column, and there is no default one for `uuid`, so without it this
    // statement fails with `data type uuid has no default operator class for
    // access method "gin"`.
    //
    // They belong in the migration precisely because installing them by hand to
    // get past the error hides it: an already-migrated database has the
    // extensions, so the statement passes there, and only a database that has
    // never been migrated reproduces the failure. It then waits for CI.
    await r.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await r.query(`CREATE EXTENSION IF NOT EXISTS btree_gin`);
    await r.query(`
      CREATE INDEX IF NOT EXISTS shipments_merchant_search_trgm_idx
        ON shipment.shipments
          USING gin (merchant_id, tracking_code gin_trgm_ops, recipient_phone gin_trgm_ops, sender_phone gin_trgm_ops)
    `);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP INDEX IF EXISTS shipment.shipments_merchant_search_trgm_idx`);
    await r.query(`DROP INDEX IF EXISTS shipment.shipments_merchant_zone_created_idx`);
    await r.query(`ALTER TABLE shipment.shipments DROP COLUMN IF EXISTS zone`);
    // The extensions are deliberately left installed. Dropping them would fail
    // if any other index depends on them, and an extension is a database-wide
    // capability rather than something this migration owns.
  }
}
