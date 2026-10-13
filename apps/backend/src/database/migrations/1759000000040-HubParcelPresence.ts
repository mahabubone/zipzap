import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * hub.parcel_presence — which parcel is sitting at which hub, right now.
 *
 * ## Why this table exists
 *
 * `POST /v1/hubs/scans` has existed since Phase 5 rung 2b, and it accepts a `hubCode` — but it
 * only ever VALIDATED it. Nothing recorded where the parcel went, so the two questions a hub
 * console is built on could not be asked at all:
 *
 *   - what is waiting at my hub, to be scanned?
 *   - what has this hub sent, and did it all arrive?
 *
 * The scan wrote `hubCode` into the tracking event's metadata and the outbox payload, which is
 * history — useful for an audit, useless for a work list. Reconstructing presence from it would mean
 * replaying every event ever written for every parcel at every hub, on a screen an operator opens
 * between shifts.
 *
 * `shipment.shipments` has no `hub_id`, and adding one would mean the `hub` module writing a
 * column on another module's table. This table keeps the fact in the schema that owns it, which is
 * what rule 2 is actually for.
 *
 * ## Shape
 *
 * One row per parcel currently in the network's custody, keyed by shipment. Departure DELETES the
 * row rather than setting a flag: "not at any hub" and "at a hub but we forgot to clear it" are
 * different states, and a `left_at` column invites the second one.
 *
 * `last_scan` is what the console renders as "next: SORT", so the next expected gesture is a
 * projection of the last one rather than a second source of truth.
 *
 * NOT append-only, deliberately. This is present tense, not history — `tracking.events` is where
 * the history lives, and this table is allowed to forget.
 */
export class HubParcelPresence1759000000040 implements MigrationInterface {
  name = 'HubParcelPresence1759000000040';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE IF NOT EXISTS hub.parcel_presence (
        shipment_id  uuid        PRIMARY KEY,
        hub_id       uuid        NOT NULL REFERENCES hub.hubs (id),
        hub_code     text        NOT NULL,
        tracking_code text       NOT NULL,
        last_scan    text        NOT NULL,
        scanned_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      )
    `);

    // The console's only hot read: everything waiting at one hub, most recently scanned first.
    await r.query(
      `CREATE INDEX IF NOT EXISTS parcel_presence_hub_idx
         ON hub.parcel_presence (hub_id, scanned_at DESC)`,
    );

    // Departure and reconciliation both ask "which hub did this parcel leave", and the row is gone
    // by then, so the index is on what the row carried rather than on the row.
    await r.query(
      `CREATE INDEX IF NOT EXISTS parcel_presence_shipment_idx
         ON hub.parcel_presence (shipment_id)`,
    );
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS hub.parcel_presence`);
  }
}
