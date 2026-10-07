/**
 * The operational report (Phase 6 rung 6): one request, two time-views.
 *
 * - **historical** — KPIs summed from the analytics projections over an
 *   inclusive Asia/Dhaka day range (event-fed, rebuildable, never transactional
 *   data — docs/domains/analytics.md).
 * - **live** — the point-in-time operational numbers the "Operations" dashboard
 *   row exists for (hub backlog, exceptions, rider utilisation), taken from the
 *   existing read contracts rather than re-implemented.
 *
 * Deferred KPIs and why (documented in docs/domains/analytics.md): duration
 * metrics (avg delivery time, pickup SLA, transit), first-attempt rate, and
 * settlement time need timestamps the projections do not carry yet — the
 * upgrade path is payload timestamp enrichments plus accumulator columns,
 * replayed through the same `project()` code path.
 */

import { Inject, Injectable } from '@nestjs/common';
import { DashboardService } from './dashboard.service.ts';
import { UtilisationService, type PoolUtilisation } from '../rider/utilisation.service.ts';
import {
  ProjectionQueriesService,
  type CodCurrencyKpi,
  type DeliverySuccessKpi,
  type HubVolumeKpi,
  type RiderWorkKpi,
  type ReturnRateKpi,
  type ShipmentFlowKpi,
} from '../analytics/projection-queries.service.ts';
import { dayKey } from '../analytics/rules/day.ts';

const DEFAULT_WINDOW_DAYS = 30;

export interface OperationsReport {
  readonly range: { readonly from: string; readonly to: string };

  /** Sums over the range, from the analytics projections. */
  readonly shipments: ShipmentFlowKpi;
  readonly deliverySuccess: DeliverySuccessKpi;
  readonly returns: ReturnRateKpi;
  readonly cod: readonly CodCurrencyKpi[];
  readonly riderWork: RiderWorkKpi;
  readonly hubVolume: readonly HubVolumeKpi[];

  /** One instant, from the live read contracts. */
  readonly live: {
    readonly timestamp: string;
    readonly hub: { readonly backlog: number; readonly networkHubs: number };
    readonly exceptions: { readonly lostOrDamaged: number; readonly exception: number };
    readonly riders: {
      readonly total: number;
      readonly online: number;
      readonly available: number;
    };
    readonly poolUtilisation: PoolUtilisation;
  };
}

@Injectable()
export class ReportService {
  constructor(
    @Inject(DashboardService) private readonly dashboard: DashboardService,
    @Inject(UtilisationService) private readonly utilisation: UtilisationService,
    @Inject(ProjectionQueriesService) private readonly projections: ProjectionQueriesService,
  ) {}

  /** Defaults: the last 30 days ending today, both in Asia/Dhaka day buckets. */
  async getReport(from?: string, to?: string): Promise<OperationsReport> {
    const rangeTo = to ?? dayKey(new Date());
    const rangeFrom = from ?? dayKey(new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000));

    const [counts, poolUtilisation, kpis] = await Promise.all([
      this.dashboard.getLiveCounts(),
      this.utilisation.getPoolLoad(),
      this.projections.kpis(rangeFrom, rangeTo),
    ]);

    return {
      range: { from: rangeFrom, to: rangeTo },
      shipments: kpis.shipments,
      deliverySuccess: kpis.deliverySuccess,
      returns: kpis.returns,
      cod: kpis.cod,
      riderWork: kpis.riderWork,
      hubVolume: kpis.hubVolume,
      live: {
        timestamp: counts.timestamp,
        hub: { backlog: counts.hub.backlog, networkHubs: counts.hub.networkHubs },
        exceptions: {
          lostOrDamaged: counts.shipments.lostOrDamaged,
          exception: counts.shipments.exception,
        },
        riders: {
          total: counts.riders.total,
          online: counts.riders.online,
          available: counts.riders.available,
        },
        poolUtilisation,
      },
    };
  }
}
