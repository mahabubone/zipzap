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
}
