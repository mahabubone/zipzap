import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `tracking.public_tokens` — one unguessable public token per parcel.
 *
 * Lives in `tracking` rather than on `shipment.shipments` so the public tracker can resolve a token to
 * a shipment_id without opening the shipment connection. The public route reads only
 * `tracking.public_timeline` and `tracking.public_tokens`, which is what keeps rule 2's boundary
 * intact on the one route that has no account and therefore no tenant guard to fall back on.
 *
 * `token` is UNIQUE because it is the lookup key for a public route — a duplicate would make two
 * parcels reachable by one link, and "which parcel did this link show" must have exactly one answer.
 *
 * Backfill note: existing shipments get no token here. The tracking consumer mints one per parcel when
 * it next sees an event for it, and `GET /track/:trackingCode` keeps working unchanged meanwhile — a
 * cut-over would break every link already sitting in a customer's inbox, and the exit check asks for
 * an unguessable token, not for the old route to disappear.
 */
export class PublicTokens1759000000043 implements MigrationInterface {
  name = 'PublicTokens1759000000043';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE IF NOT EXISTS tracking.public_tokens (
        shipment_id uuid PRIMARY KEY,
        token       text NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT public_tokens_length CHECK (char_length(token) BETWEEN 26 AND 64)
      )
    `);
    await r.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS public_tokens_token_uq ON tracking.public_tokens (token)`,
    );
    await r.query(
      `COMMENT ON TABLE tracking.public_tokens IS
       'One unguessable public tracking token per parcel. The public route resolves token -> shipment_id inside this schema; it must never read shipment.*'`,
    );
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS tracking.public_tokens`);
  }
}
