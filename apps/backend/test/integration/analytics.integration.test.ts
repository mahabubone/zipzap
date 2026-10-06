/**
 * Integration: analytics projections against the real DB.
 *
 * Phase 6 rung 3 — two proofs that the domain doc insists on:
 *
 *  1. The consumer projects the real event shapes into the six tables, and the
 *     `consumeOnce` claim is atomic with the upserts (a redelivery writes nothing).
 *  2. `rebuild()` — the `analytics:rebuild --from=…` command — truncates and
 *     replays `system.outbox_events` through the same `project()` code path,
 *     honouring the `--from` cutoff. If this did not work, the projections
 *     would be a second source of truth (docs/domains/analytics.md).
 *
 * Synthetic outbox rows are inserted with `published_at = now()`: the table is
 * append-only (deletes are blocked by trigger) and pre-published rows are
 * skipped by the publisher, so test events never fan out to live consumers.
 * Ids are unique per run; every assertion is scoped to them.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { connectModuleDataSource } from '../../dist/database/module-connection.js';
import { rebuild } from '../../dist/database/analytics-rebuild.js';
import { AnalyticsConsumer } from '../../dist/modules/analytics/analytics.consumer.js';
import { dayKey } from '../../dist/modules/analytics/rules/day.js';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

interface SyntheticRow {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: Date;
  readonly data: Record<string, unknown>;
}

let analyticsDb: DataSource;
let systemDb: DataSource;
let consumer: AnalyticsConsumer;

const merchantId = randomUUID();
const riderId = randomUUID();
const hubCode = `AN-${Math.floor(Math.random() * 100_000)}`;
const oldMerchantId = randomUUID();

const now = new Date();
const oldOccurredAt = new Date('1999-01-01T12:00:00.000Z');
const today = dayKey(now);
const ancientDay = '1999-01-01';

let rows: SyntheticRow[] = [];

async function insertOutbox(
  type: string,
  aggregateType: string,
  data: Record<string, unknown>,
  occurredAt: Date,
): Promise<string> {
  const result: { id: unknown }[] = await systemDb.query(
    `INSERT INTO system.outbox_events
       (event_type, aggregate_type, aggregate_id, payload, occurred_at, published_at)
     VALUES ($1, $2, $3, $4, $5, now())
     RETURNING id`,
    [type, aggregateType, randomUUID(), JSON.stringify(data), occurredAt],
  );
  return String(result[0].id);
}

async function scalar(sql: string, params: unknown[]): Promise<number> {
  const result: Record<string, unknown>[] = await analyticsDb.query(sql, params);
  const first = Object.values(result[0] ?? {})[0];
  return Number(first ?? 0);
}

function envelopeFor(row: SyntheticRow) {
  return {
    subject: `zipzap.test.${row.type.toLowerCase()}`,
    payload: new TextEncoder().encode(
      JSON.stringify({
        id: row.id,
        type: row.type,
        aggregateType: 'integration',
        aggregateId: row.id,
        occurredAt: row.occurredAt.toISOString(),
        data: row.data,
      }),
    ),
  };
}

describeIfDb('analytics projections', () => {
  before(async () => {
    analyticsDb = await connectModuleDataSource('analytics', []);
    systemDb = await connectModuleDataSource('system', []);
    consumer = new AnalyticsConsumer(analyticsDb);

    // Projections are rebuildable scratch — start from empty so the exact-count
    // assertions below cannot be disturbed by history replayed in an earlier run.
    await analyticsDb.query(
      `TRUNCATE TABLE analytics.merchant_daily_shipments, analytics.hub_daily_volume,
         analytics.rider_daily_performance, analytics.delivery_success_rate,
         analytics.return_rate, analytics.cod_summary`,
    );
    const definitions: {
      type: string;
      aggregate: string;
      data: Record<string, unknown>;
      occurredAt: Date;
    }[] = [
      {
        type: 'ShipmentCreated',
        aggregate: 'shipment',
        data: { merchantId },
        occurredAt: now,
      },
      {
        type: 'ShipmentCreated',
        aggregate: 'shipment',
        data: { merchantId: oldMerchantId },
        occurredAt: oldOccurredAt,
      },
      {
        type: 'PickupParcelScanned',
        aggregate: 'pickup',
        data: { merchantId, pickupStatus: 'IN_PROGRESS' },
        occurredAt: now,
      },
      {
        type: 'DeliveryCompleted',
        aggregate: 'delivery',
        data: { merchantId, riderId },
        occurredAt: now,
      },
      {
        type: 'DeliveryAttempted',
        aggregate: 'delivery',
        data: { riderId, retryScheduled: false, reason: 'WRONG_ADDRESS' },
        occurredAt: now,
      },
      {
        type: 'CODPartialCollection',
        aggregate: 'cod',
        data: { merchantId, currency: 'BDT', expectedMinor: 1000, collectedMinor: 900 },
        occurredAt: now,
      },
      {
        type: 'SettlementCompleted',
        aggregate: 'settlement',
        data: { merchantId, currency: 'BDT', netMinor: 500 },
        occurredAt: now,
      },
      {
        type: 'ShipmentScanned',
        aggregate: 'shipment',
        data: { hubCode, scan: 'INBOUND' },
        occurredAt: now,
      },
      {
        type: 'ReturnCompleted',
        aggregate: 'return',
        data: { merchantId },
        occurredAt: now,
      },
    ];

    rows = await Promise.all(
      definitions.map(async (d) => ({
        id: await insertOutbox(d.type, d.aggregate, d.data, d.occurredAt),
        type: d.type,
        occurredAt: d.occurredAt,
        data: d.data,
      })),
    );
  });

  after(async () => {
    await analyticsDb?.destroy();
    await systemDb?.destroy();
  });

  test('consumer projects every event shape into its table', async () => {
    for (const row of rows) {
      const outcome = await consumer.handle(envelopeFor(row));
      assert.equal(outcome, 'processed', `${row.type} should process`);
    }

    // merchant_daily_shipments: created + picked_up + delivered today; the
    // ancient event lands on its own 1999 day.
    assert.equal(
      await scalar(
        `SELECT shipments_created FROM analytics.merchant_daily_shipments
          WHERE merchant_id = $1 AND day = $2`,
        [merchantId, today],
      ),
      1,
    );
    assert.equal(
      await scalar(
        `SELECT picked_up FROM analytics.merchant_daily_shipments
          WHERE merchant_id = $1 AND day = $2`,
        [merchantId, today],
      ),
      1,
    );
    assert.equal(
      await scalar(
        `SELECT delivered FROM analytics.merchant_daily_shipments
          WHERE merchant_id = $1 AND day = $2`,
        [merchantId, today],
      ),
      1,
    );
    assert.equal(
      await scalar(
        `SELECT shipments_created FROM analytics.merchant_daily_shipments
          WHERE merchant_id = $1 AND day = $2`,
        [oldMerchantId, ancientDay],
      ),
      1,
    );

    // rider_daily_performance: one delivered, one terminal attempt.
    assert.equal(
      await scalar(
        `SELECT delivered FROM analytics.rider_daily_performance
          WHERE rider_id = $1 AND day = $2`,
        [riderId, today],
      ),
      1,
    );
    assert.equal(
      await scalar(
        `SELECT attempts FROM analytics.rider_daily_performance
          WHERE rider_id = $1 AND day = $2`,
        [riderId, today],
      ),
      1,
    );
    assert.equal(
      await scalar(
        `SELECT failed FROM analytics.rider_daily_performance
          WHERE rider_id = $1 AND day = $2`,
        [riderId, today],
      ),
      1,
    );

    // Global rate tables store counts; rates are read-time maths.
    assert.equal(
      await scalar(`SELECT delivered FROM analytics.delivery_success_rate WHERE day = $1`, [today]),
      1,
    );
    assert.equal(
      await scalar(`SELECT failed FROM analytics.delivery_success_rate WHERE day = $1`, [today]),
      1,
    );
    assert.equal(
      await scalar(`SELECT delivered FROM analytics.return_rate WHERE day = $1`, [today]),
      1,
    );
    assert.equal(
      await scalar(`SELECT returned FROM analytics.return_rate WHERE day = $1`, [today]),
      1,
    );

    // cod_summary: expected + collected from the partial, settled from the payout —
    // one row, bigint money, currency carried alongside.
    assert.equal(
      await scalar(
        `SELECT expected_minor FROM analytics.cod_summary WHERE day = $1 AND currency = 'BDT'`,
        [today],
      ),
      1000,
    );
    assert.equal(
      await scalar(
        `SELECT collected_minor FROM analytics.cod_summary WHERE day = $1 AND currency = 'BDT'`,
        [today],
      ),
      900,
    );
    assert.equal(
      await scalar(
        `SELECT settled_minor FROM analytics.cod_summary WHERE day = $1 AND currency = 'BDT'`,
        [today],
      ),
      500,
    );

    // hub_daily_volume
    assert.equal(
      await scalar(
        `SELECT scans FROM analytics.hub_daily_volume WHERE hub_code = $1 AND day = $2`,
        [hubCode, today],
      ),
      1,
    );
  });

  test('redelivery is a duplicate and changes nothing', async () => {
    const row = rows.find((r) => r.type === 'ShipmentCreated' && r.data.merchantId === merchantId)!;
    const before = await scalar(
      `SELECT shipments_created FROM analytics.merchant_daily_shipments
        WHERE merchant_id = $1 AND day = $2`,
      [merchantId, today],
    );

    const outcome = await consumer.handle(envelopeFor(row));
    assert.equal(outcome, 'duplicate');

    const after = await scalar(
      `SELECT shipments_created FROM analytics.merchant_daily_shipments
        WHERE merchant_id = $1 AND day = $2`,
      [merchantId, today],
    );
    assert.equal(after, before, 'duplicate must not double-count');
  });

  test('rebuild honours --from: 2026 excludes the 1999 event', async () => {
    const result = await rebuild(analyticsDb, '2026-01-01');
    assert.ok(result.applied >= rows.length - 1, 'replay applies the recent rows');

    assert.equal(
      await scalar(
        `SELECT shipments_created FROM analytics.merchant_daily_shipments
          WHERE merchant_id = $1 AND day = $2`,
        [oldMerchantId, ancientDay],
      ),
      0,
      'event before --from must not be projected',
    );
    assert.equal(
      await scalar(
        `SELECT shipments_created FROM analytics.merchant_daily_shipments
          WHERE merchant_id = $1 AND day = $2`,
        [merchantId, today],
      ),
      1,
      'rebuild reproduces the count from the outbox alone',
    );
  });

  test('rebuild from 1970 replays the whole history', async () => {
    const result = await rebuild(analyticsDb, '1970-01-01');
    assert.ok(result.replayed > 0);

    assert.equal(
      await scalar(
        `SELECT shipments_created FROM analytics.merchant_daily_shipments
          WHERE merchant_id = $1 AND day = $2`,
        [oldMerchantId, ancientDay],
      ),
      1,
      'ancient event is included when --from predates it',
    );
  });

  test('rejects a malformed --from', async () => {
    await assert.rejects(() => rebuild(analyticsDb, 'not-a-date'), /yyyy-mm-dd/);
  });
});
