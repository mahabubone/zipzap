import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `network:read` — the control tower's own scope.
 *
 * `GET /v1/control-tower/report` and `GET /v1/control-tower/live-counts` were guarded by
 * `ApiKeyGuard` alone. That guard authenticates; it does not authorize. So any merchant API key
 * received HTTP 200 and a network-wide body: every merchant's shipment counts, COD
 * expected/collected/settled in poisha, return rates, rider work and hub volumes. `.../map` was
 * already correct because it named the platform scope `hub:read`.
 *
 * The scope was missing rather than merely unenforced — `API_SCOPES` had nothing for a guard to
 * name — so this is the same fix as `0042-RiderSyncScope`, for the same reason.
 *
 * Platform: it is the network, not one account. A merchant reads their own numbers from
 * `GET /v1/analytics/merchant`, which filters by the principal's merchantId.
 *
 * Postgres cannot drop an enum value, so `down` is a no-op. That is a property of the type system,
 * not a choice — see ADR-0012's note on the same asymmetry for the command vocabulary.
 */
export class NetworkReadScope1759000000046 implements MigrationInterface {
  name = 'NetworkReadScope1759000000046';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TYPE merchant.api_scope ADD VALUE IF NOT EXISTS 'network:read'`);
  }

  /** Intentionally empty: Postgres cannot remove an enum label without recreating the type. */
  public async down(): Promise<void> {
    // no-op
  }
}
