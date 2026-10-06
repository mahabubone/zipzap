/**
 * The six analytics projections, as event handlers (Phase 6 rung 3).
 *
 * One function per event type, all of them pure upserts on the caller's
 * EntityManager: the consumer wraps them in `consumeOnce` (dedupe atomic with
 * the write), the rebuild CLI replays them straight from `system.outbox_events`
 * after truncating — one implementation, two feed paths, so a projection cannot
 * disagree with its own rebuild (docs/domains/analytics.md).
 *
 * Every counter is an integer; every money column is bigint minor units paired
 * with its `currency` column in the same row (AGENTS.md rule 4). Column names
 * are literal union types, never user input — the interpolation is bounded by
 * the type, not by trust.
 */

import type { EntityManager } from 'typeorm';
import { dayKey } from './rules/day.ts';

/** Event types this consumer handles. Pinned by subscriptions.spec.ts parity. */
export const ANALYTICS_HANDLED_TYPES = [
  'ShipmentCreated',
  'PickupParcelScanned',
  'DeliveryCompleted',
  'DeliveryAttempted',
  'CODCollected',
  'CODPartialCollection',
  'SettlementCompleted',
  'ShipmentScanned',
  'ReturnCompleted',
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_HANDLED_TYPES)[number];

export function isAnalyticsEventType(type: string): type is AnalyticsEventType {
  return (ANALYTICS_HANDLED_TYPES as readonly string[]).includes(type);
}

type MerchantCounter = 'shipments_created' | 'picked_up' | 'delivered';
type RiderCounter = 'delivered' | 'attempts' | 'failed';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function int(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

async function bumpMerchantDay(
  manager: EntityManager,
  merchantId: string,
  day: string,
  column: MerchantCounter,
): Promise<void> {
  await manager.query(
    `INSERT INTO analytics.merchant_daily_shipments (merchant_id, day, ${column})
     VALUES ($1, $2, 1)
     ON CONFLICT (merchant_id, day)
     DO UPDATE SET ${column} = analytics.merchant_daily_shipments.${column} + 1`,
    [merchantId, day],
  );
}

async function bumpRiderDay(
  manager: EntityManager,
  riderId: string,
  day: string,
  column: RiderCounter,
): Promise<void> {
  await manager.query(
    `INSERT INTO analytics.rider_daily_performance (rider_id, day, ${column})
     VALUES ($1, $2, 1)
     ON CONFLICT (rider_id, day)
     DO UPDATE SET ${column} = analytics.rider_daily_performance.${column} + 1`,
    [riderId, day],
  );
}

async function bumpDeliverySuccess(
  manager: EntityManager,
  day: string,
  column: 'delivered' | 'failed',
): Promise<void> {
  await manager.query(
    `INSERT INTO analytics.delivery_success_rate (day, ${column})
     VALUES ($1, 1)
     ON CONFLICT (day)
     DO UPDATE SET ${column} = analytics.delivery_success_rate.${column} + 1`,
    [day],
  );
}

async function bumpReturnRate(
  manager: EntityManager,
  day: string,
  column: 'delivered' | 'returned',
): Promise<void> {
  await manager.query(
    `INSERT INTO analytics.return_rate (day, ${column})
     VALUES ($1, 1)
     ON CONFLICT (day)
     DO UPDATE SET ${column} = analytics.return_rate.${column} + 1`,
    [day],
  );
}

async function bumpHubVolume(manager: EntityManager, hubCode: string, day: string): Promise<void> {
  await manager.query(
    `INSERT INTO analytics.hub_daily_volume (hub_code, day, scans)
     VALUES ($1, $2, 1)
     ON CONFLICT (hub_code, day)
     DO UPDATE SET scans = analytics.hub_daily_volume.scans + 1`,
    [hubCode, day],
  );
}

async function accumulateCodSummary(
  manager: EntityManager,
  day: string,
  currency: string,
  expectedMinor: number,
  collectedMinor: number,
  settledMinor: number,
): Promise<void> {
  await manager.query(
    `INSERT INTO analytics.cod_summary
       (day, currency, expected_minor, collected_minor, settled_minor)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (day, currency)
     DO UPDATE SET
       expected_minor  = analytics.cod_summary.expected_minor  + excluded.expected_minor,
       collected_minor = analytics.cod_summary.collected_minor + excluded.collected_minor,
       settled_minor   = analytics.cod_summary.settled_minor   + excluded.settled_minor`,
    [day, currency, expectedMinor, collectedMinor, settledMinor],
  );
}

export interface ProjectionInput {
  readonly type: AnalyticsEventType;
  readonly occurredAt: Date;
  readonly data: Record<string, unknown>;
}

/**
 * Apply one event to the projections. Callers own the transaction. Returns
 * silently when identity is missing from the payload — an event that cannot be
 * attributed is skipped, never fatal (same contract as the tracking consumer).
 */
export async function project(manager: EntityManager, input: ProjectionInput): Promise<void> {
  const day = dayKey(input.occurredAt);
  const data = input.data;

  switch (input.type) {
    case 'ShipmentCreated': {
      const merchantId = str(data.merchantId);
      if (merchantId) await bumpMerchantDay(manager, merchantId, day, 'shipments_created');
      return;
    }

    // One scan = one shipment picked up (scan-parcel advances each parcel
    // individually; the pickup row's own status is IN_PROGRESS or COMPLETED).
    case 'PickupParcelScanned': {
      const merchantId = str(data.merchantId);
      if (merchantId) await bumpMerchantDay(manager, merchantId, day, 'picked_up');
      return;
    }

    case 'DeliveryCompleted': {
      const merchantId = str(data.merchantId);
      const riderId = str(data.riderId);
      if (merchantId) await bumpMerchantDay(manager, merchantId, day, 'delivered');
      if (riderId) await bumpRiderDay(manager, riderId, day, 'delivered');
      await bumpDeliverySuccess(manager, day, 'delivered');
      await bumpReturnRate(manager, day, 'delivered');
      return;
    }

    // Every attempt is a failed delivery attempt; `retryScheduled: false` is
    // the terminal failure the success-rate KPI counts as `failed`.
    case 'DeliveryAttempted': {
      const terminal = data.retryScheduled === false;
      if (terminal) await bumpDeliverySuccess(manager, day, 'failed');
      const riderId = str(data.riderId);
      if (riderId) {
        await bumpRiderDay(manager, riderId, day, 'attempts');
        if (terminal) await bumpRiderDay(manager, riderId, day, 'failed');
      }
      return;
    }

    case 'CODCollected':
    case 'CODPartialCollection': {
      const currency = str(data.currency) || 'BDT';
      await accumulateCodSummary(
        manager,
        day,
        currency,
        int(data.expectedMinor),
        int(data.collectedMinor),
        0,
      );
      return;
    }

    case 'SettlementCompleted': {
      const currency = str(data.currency) || 'BDT';
      await accumulateCodSummary(manager, day, currency, 0, 0, int(data.netMinor));
      return;
    }

    // Non-hub scans carry no hubCode and cannot be attributed to a volume row.
    case 'ShipmentScanned': {
      const hubCode = str(data.hubCode);
      if (hubCode) await bumpHubVolume(manager, hubCode, day);
      return;
    }

    case 'ReturnCompleted': {
      await bumpReturnRate(manager, day, 'returned');
      return;
    }
  }
}
