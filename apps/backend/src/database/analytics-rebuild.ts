/**
 * Projection rebuild — the command docs/domains/analytics.md says must work.
 *
 * Source of truth is `system.outbox_events`: append-only, so it holds every
 * event ever published. The rebuild truncates the six projection tables and
 * replays the outbox from `--from` through the SAME `project()` function the
 * live consumer runs — if the two paths could disagree, one of them would be
 * a second source of truth, which is exactly the bug this exists to prevent.
 *
 * One transaction for the whole replay: TRUNCATE is transactional in
 * Postgres, so a crash mid-rebuild leaves the old projections intact rather
 * than a half-wiped state. `ponytail:` if the outbox grows past what one
 * transaction can write comfortably, batch with a checkpoint column on the
 * projections instead — the truncate-first semantics stay.
 */

import type { DataSource } from 'typeorm';
import {
  isAnalyticsEventType,
  project,
  type AnalyticsEventType,
} from '../modules/analytics/projections.ts';

const PROJECTION_TABLES = [
  'analytics.merchant_daily_shipments',
  'analytics.hub_daily_volume',
  'analytics.rider_daily_performance',
  'analytics.delivery_success_rate',
  'analytics.return_rate',
  'analytics.cod_summary',
] as const;

const BATCH = 1000;

export interface RebuildResult {
  /** Outbox rows examined. */
  readonly replayed: number;
  /** Rows that matched an analytics event type and were projected. */
  readonly applied: number;
}

/** Validate and normalise a `--from` value (`yyyy-mm-dd`). */
export function parseFrom(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`--from must be yyyy-mm-dd, received "${value}".`);
  }
  return value;
}

export async function rebuild(dataSource: DataSource, from: string): Promise<RebuildResult> {
  const fromDate = new Date(`${parseFrom(from)}T00:00:00.000Z`);

  return dataSource.transaction(async (manager) => {
    await manager.query(`TRUNCATE TABLE ${PROJECTION_TABLES.join(', ')}`);

    let cursor = '0';
    let replayed = 0;
    let applied = 0;

    for (;;) {
      const rows: { id: unknown; event_type: string; occurred_at: Date; payload: unknown }[] =
        await manager.query(
          `SELECT id, event_type, occurred_at, payload
             FROM system.outbox_events
            WHERE id > $1 AND occurred_at >= $2
            ORDER BY id
            LIMIT $3`,
          [cursor, fromDate, BATCH],
        );
      if (rows.length === 0) break;

      for (const row of rows) {
        cursor = String(row.id);
        replayed += 1;
        if (isAnalyticsEventType(row.event_type)) {
          await project(manager, {
            type: row.event_type as AnalyticsEventType,
            occurredAt: row.occurred_at,
            data: (row.payload ?? {}) as Record<string, unknown>,
          });
          applied += 1;
        }
      }
    }

    return { replayed, applied };
  });
}
