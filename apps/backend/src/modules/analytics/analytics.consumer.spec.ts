/**
 * The analytics consumer's contract, minus the database.
 *
 * What these prove: every handled event type routes to the right projection
 * upserts (table, counter column, bound params), unattributable payloads skip
 * without writing, unknown types are ignored and unparseable payloads are
 * malformed — never fatal — and the dedupe claim decides duplicate vs
 * processed. Atomicity of claim+project against real Postgres is proven by
 * test/integration/analytics.integration.test.ts, which also proves rebuild.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { AnalyticsConsumer } from './analytics.consumer.ts';

interface Captured {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function message(type: string, data: Record<string, unknown> | null, id = 'evt-1') {
  return {
    subject: `zipzap.test.${type.toLowerCase()}`,
    payload: new TextEncoder().encode(
      data === null
        ? '{not json'
        : JSON.stringify({
            id,
            type,
            aggregateType: 'x',
            aggregateId: 'a-1',
            occurredAt: '2026-03-05T12:00:00.000Z',
            data,
          }),
    ),
  };
}

describe('AnalyticsConsumer', () => {
  let consumer: AnalyticsConsumer;
  let writes: Captured[];
  let claimed: boolean;

  beforeEach(() => {
    writes = [];
    claimed = true;
    const fake = {
      transaction: async (fn: (manager: unknown) => Promise<unknown>) =>
        fn({
          query: async (sql: string, params: unknown[]) => {
            if (sql.includes('consumed_events')) return claimed ? [{ event_id: 'evt-1' }] : [];
            writes.push({ sql, params });
            return [];
          },
        }),
    };
    consumer = new AnalyticsConsumer(fake as never);
  });

  const tableWrites = (fragment: string): Captured[] =>
    writes.filter((w) => w.sql.includes(fragment));

  it('ShipmentCreated bumps merchant shipments_created on the Dhaka day', async () => {
    const outcome = await consumer.handle(message('ShipmentCreated', { merchantId: 'm-1' }));
    expect(outcome).toBe('processed');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.sql).toContain('analytics.merchant_daily_shipments');
    expect(writes[0]!.sql).toContain('shipments_created');
    // 2026-03-05T12:00Z is still 2026-03-05 in Dhaka (UTC+6).
    expect(writes[0]!.params).toEqual(['m-1', '2026-03-05']);
  });

  it('DeliveryCompleted feeds merchant, rider, success and return projections', async () => {
    await consumer.handle(message('DeliveryCompleted', { merchantId: 'm-1', riderId: 'r-1' }));
    expect(tableWrites('merchant_daily_shipments')).toHaveLength(1);
    expect(tableWrites('merchant_daily_shipments')[0]!.sql).toContain('delivered');
    expect(tableWrites('rider_daily_performance')).toHaveLength(1);
    expect(tableWrites('rider_daily_performance')[0]!.sql).toContain('delivered');
    expect(tableWrites('delivery_success_rate')).toHaveLength(1);
    expect(tableWrites('return_rate')).toHaveLength(1);
  });

  it('terminal DeliveryAttempted counts failed everywhere; retryable does not', async () => {
    await consumer.handle(message('DeliveryAttempted', { riderId: 'r-1', retryScheduled: false }));
    expect(tableWrites('delivery_success_rate')[0]!.sql).toContain('failed');
    expect(tableWrites('rider_daily_performance')).toHaveLength(2); // attempts + failed
    expect(tableWrites('rider_daily_performance').every((w) => w.params[0] === 'r-1')).toBe(true);

    writes = [];
    await consumer.handle(message('DeliveryAttempted', { riderId: 'r-1', retryScheduled: true }));
    expect(tableWrites('delivery_success_rate')).toHaveLength(0);
    expect(tableWrites('rider_daily_performance')).toHaveLength(1); // attempts only
  });

  it('COD events accumulate expected and collected into one currency row', async () => {
    await consumer.handle(
      message('CODPartialCollection', {
        currency: 'BDT',
        expectedMinor: 125050,
        collectedMinor: 125000,
      }),
    );
    const cod = tableWrites('cod_summary');
    expect(cod).toHaveLength(1);
    expect(cod[0]!.params).toEqual(['2026-03-05', 'BDT', 125050, 125000, 0]);
  });

  it('SettlementCompleted accumulates settled_minor with its currency', async () => {
    await consumer.handle(message('SettlementCompleted', { currency: 'BDT', netMinor: 900000 }));
    const cod = tableWrites('cod_summary');
    expect(cod[0]!.params).toEqual(['2026-03-05', 'BDT', 0, 0, 900000]);
  });

  it('ShipmentScanned with a hubCode counts volume; without one it skips', async () => {
    await consumer.handle(message('ShipmentScanned', { hubCode: 'DAC-01', scan: 'INBOUND' }));
    expect(tableWrites('hub_daily_volume')).toHaveLength(1);
    expect(tableWrites('hub_daily_volume')[0]!.params).toEqual(['DAC-01', '2026-03-05']);

    writes = [];
    await consumer.handle(message('ShipmentScanned', { hubCode: null }));
    expect(writes).toHaveLength(0);
  });

  it('PickupParcelScanned counts picked_up for the merchant', async () => {
    await consumer.handle(
      message('PickupParcelScanned', { merchantId: 'm-1', pickupStatus: 'IN_PROGRESS' }),
    );
    expect(tableWrites('merchant_daily_shipments')[0]!.sql).toContain('picked_up');
  });

  it('ReturnCompleted bumps return_rate.returned', async () => {
    await consumer.handle(message('ReturnCompleted', { merchantId: 'm-1' }));
    expect(tableWrites('return_rate')[0]!.sql).toContain('returned');
  });

  it('missing merchant identity writes nothing but still claims processed', async () => {
    const outcome = await consumer.handle(message('ShipmentCreated', { merchantId: null }));
    expect(outcome).toBe('processed');
    expect(writes).toHaveLength(0);
  });

  it('unknown types are ignored, unparseable payloads are malformed', async () => {
    expect(await consumer.handle(message('SomethingElse', {}))).toBe('ignored');
    expect(await consumer.handle(message('ShipmentCreated', null))).toBe('malformed');
    expect(writes).toHaveLength(0);
  });

  it('a lost dedupe claim reports duplicate and writes nothing', async () => {
    claimed = false;
    const outcome = await consumer.handle(message('ShipmentCreated', { merchantId: 'm-1' }));
    expect(outcome).toBe('duplicate');
    expect(writes).toHaveLength(0);
  });
});
