/**
 * Read-model queries over the six analytics projections (Phase 6 rung 6 —
 * operational reports).
 *
 * Reads ONLY the `analytics` schema: the projections are fed by events and are
 * the report's only source (docs/domains/analytics.md). Ranges are day-grained
 * in Asia/Dhaka buckets; `from`/`to` are inclusive `yyyy-mm-dd`.
 *
 * Rates are computed here as ratios with a null denominator guard — "0% success
 * rate" for a window with no traffic is a lie a dashboard would happily draw,
 * so an empty window reports null, not zero.
 */

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

export interface ShipmentFlowKpi {
  readonly created: number;
  readonly pickedUp: number;
  readonly delivered: number;
}

export interface DeliverySuccessKpi {
  readonly delivered: number;
  readonly failed: number;
  /** delivered / (delivered + failed); null when the window saw no resolved delivery. */
  readonly rate: number | null;
}

export interface ReturnRateKpi {
  readonly delivered: number;
  readonly returned: number;
  /** returned / delivered; null when the window saw no delivery. */
  readonly rate: number | null;
}

export interface CodCurrencyKpi {
  readonly currency: string;
  readonly expectedMinor: number;
  readonly collectedMinor: number;
  readonly settledMinor: number;
  /** collected / expected; null when nothing was expected in the window. */
  readonly collectionRate: number | null;
}

export interface RiderWorkKpi {
  readonly delivered: number;
  readonly attempts: number;
  readonly failed: number;
}

export interface HubVolumeKpi {
  readonly hubCode: string;
  readonly scans: number;
}

export interface ProjectionKpis {
  readonly shipments: ShipmentFlowKpi;
  readonly deliverySuccess: DeliverySuccessKpi;
  readonly returns: ReturnRateKpi;
  readonly cod: readonly CodCurrencyKpi[];
  readonly riderWork: RiderWorkKpi;
  readonly hubVolume: readonly HubVolumeKpi[];
}

/**
 * One merchant's own daily series: parcels on the left, money on the right.
 *
 * Both halves come from projections and both are merchant-scoped, so this is the tenant's own
 * numbers and nothing else. Deliberately not here: delivery success rate and return rate. Those
 * projections are network-wide because their failure counts come from `DeliveryAttempted`, which
 * carries no `merchantId` — a chart that drew them per merchant would be drawing a number this
 * data cannot support (migration `0047`).
 *
 * Money crosses as `string`. A poisha amount above 2^53 loses precision as a JSON number, which is
 * the same reason `DashboardController` serialises its bigint at the edge — but this one is a
 * projection read, so the cast belongs on the row rather than in a controller.
 */
export interface MerchantDayPoint {
  readonly day: string;
  readonly shipmentsCreated: number;
  readonly pickedUp: number;
  readonly delivered: number;
  readonly currency: string | null;
  readonly expectedMinor: string;
  readonly collectedMinor: string;
  readonly settledMinor: string;
}

export interface MerchantSeries {
  readonly from: string;
  readonly to: string;
  readonly days: readonly MerchantDayPoint[];
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function int(value: unknown): number {
  return Math.trunc(num(value));
}

@Injectable()
export class ProjectionQueriesService {
  constructor(@InjectDataSource('analytics') private readonly analytics: DataSource) {}

  async kpis(from: string, to: string): Promise<ProjectionKpis> {
    return this.analytics.transaction(async (manager) => {
      const shipments = (
        await manager.query(
          `SELECT COALESCE(SUM(shipments_created), 0)::int AS created,
                COALESCE(SUM(picked_up), 0)::int AS "pickedUp",
                COALESCE(SUM(delivered), 0)::int AS delivered
           FROM analytics.merchant_daily_shipments
          WHERE day BETWEEN $1 AND $2`,
          [from, to],
        )
      )[0] as Record<string, unknown> | undefined;

      const delivery = (
        await manager.query(
          `SELECT COALESCE(SUM(delivered), 0)::int AS delivered,
                COALESCE(SUM(failed), 0)::int AS failed
           FROM analytics.delivery_success_rate
          WHERE day BETWEEN $1 AND $2`,
          [from, to],
        )
      )[0] as Record<string, unknown> | undefined;

      const returns = (
        await manager.query(
          `SELECT COALESCE(SUM(delivered), 0)::int AS delivered,
                COALESCE(SUM(returned), 0)::int AS returned
           FROM analytics.return_rate
          WHERE day BETWEEN $1 AND $2`,
          [from, to],
        )
      )[0] as Record<string, unknown> | undefined;

      const cod = (await manager.query(
        `SELECT currency,
                SUM(expected_minor)::bigint AS "expectedMinor",
                SUM(collected_minor)::bigint AS "collectedMinor",
                SUM(settled_minor)::bigint AS "settledMinor"
           FROM analytics.cod_summary
          WHERE day BETWEEN $1 AND $2
          GROUP BY currency
          ORDER BY currency`,
        [from, to],
      )) as Record<string, unknown>[];

      const rider = (
        await manager.query(
          `SELECT COALESCE(SUM(delivered), 0)::int AS delivered,
                COALESCE(SUM(attempts), 0)::int AS attempts,
                COALESCE(SUM(failed), 0)::int AS failed
           FROM analytics.rider_daily_performance
          WHERE day BETWEEN $1 AND $2`,
          [from, to],
        )
      )[0] as Record<string, unknown> | undefined;

      const hub = (await manager.query(
        `SELECT hub_code AS "hubCode", SUM(scans)::int AS scans
           FROM analytics.hub_daily_volume
          WHERE day BETWEEN $1 AND $2
          GROUP BY hub_code
          ORDER BY SUM(scans) DESC, hub_code`,
        [from, to],
      )) as Record<string, unknown>[];

      const deliveryDelivered = int(delivery?.delivered);
      const deliveryFailed = int(delivery?.failed);
      const returnDelivered = int(returns?.delivered);
      const returned = int(returns?.returned);

      return {
        shipments: {
          created: int(shipments?.created),
          pickedUp: int(shipments?.pickedUp),
          delivered: int(shipments?.delivered),
        },
        deliverySuccess: {
          delivered: deliveryDelivered,
          failed: deliveryFailed,
          rate: ratio(deliveryDelivered, deliveryDelivered + deliveryFailed),
        },
        returns: {
          delivered: returnDelivered,
          returned,
          rate: ratio(returned, returnDelivered),
        },
        cod: cod.map((row) => {
          const expectedMinor = num(row.expectedMinor);
          const collectedMinor = num(row.collectedMinor);
          return {
            currency: String(row.currency),
            expectedMinor,
            collectedMinor,
            settledMinor: num(row.settledMinor),
            collectionRate: ratio(collectedMinor, expectedMinor),
          };
        }),
        riderWork: {
          delivered: int(rider?.delivered),
          attempts: int(rider?.attempts),
          failed: int(rider?.failed),
        },
        hubVolume: hub.map((row) => ({
          hubCode: String(row.hubCode),
          scans: int(row.scans),
        })),
      };
    });
  }

  /**
   * One merchant's daily series over an inclusive `yyyy-mm-dd` range.
   *
   * `merchantId` is a required parameter rather than something read off a request, so the only way
   * to reach this data is to already know whose it is. Both tables are filtered by it — the parcels
   * half and the money half — so a merchant asking twice gets their own numbers twice.
   *
   * `ponytail:` a day is one point per currency, because `cod_summary` is keyed by currency and a
   * figure without one is not money (rule 4). Every account in the product settles in BDT today, so
   * this returns one point per day; if a second currency ever appears for the same merchant, add an
   * explicit `currency` filter here rather than summing across currencies.
   */
  async merchantSeries(merchantId: string, from: string, to: string): Promise<MerchantSeries> {
    const rows = await this.analytics.transaction(async (manager) => {
      const shipments = await manager.query(
        `SELECT day::text AS day,
                COALESCE(shipments_created, 0)::int AS "created",
                COALESCE(picked_up, 0)::int AS "pickedUp",
                COALESCE(delivered, 0)::int AS delivered
           FROM analytics.merchant_daily_shipments
          WHERE merchant_id = $1 AND day BETWEEN $2 AND $3`,
        [merchantId, from, to],
      );

      const cod = await manager.query(
        `SELECT day::text AS day, currency,
                SUM(expected_minor)::text  AS "expectedMinor",
                SUM(collected_minor)::text AS "collectedMinor",
                SUM(settled_minor)::text   AS "settledMinor"
           FROM analytics.cod_summary
          WHERE merchant_id = $1 AND day BETWEEN $2 AND $3
          GROUP BY day, currency
          ORDER BY day`,
        [merchantId, from, to],
      );

      return { shipments, cod };
    });

    // LEFT JOIN from the parcel side: a day with collections but no shipments is still a day the
    // reader is waiting for, and a full outer join would need both sides coalesced to nothing.
    const codByDay = new Map<string, Record<string, unknown>>();
    for (const row of rows.cod as Record<string, unknown>[]) codByDay.set(String(row.day), row);

    const days: MerchantDayPoint[] = (rows.shipments as Record<string, unknown>[]).map((row) => {
      const day = String(row.day);
      const money = codByDay.get(day);
      return {
        day,
        shipmentsCreated: int(row.created),
        pickedUp: int(row.pickedUp),
        delivered: int(row.delivered),
        currency: money ? String(money.currency) : null,
        expectedMinor: money ? String(money.expectedMinor) : '0',
        collectedMinor: money ? String(money.collectedMinor) : '0',
        settledMinor: money ? String(money.settledMinor) : '0',
      };
    });

    return { from, to, days };
  }
}
