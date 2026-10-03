import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { TrackingConsumer } from './tracking.consumer.ts';
import { ShipmentLookup, SHIPMENT_LOOKUP } from '../shipment/shipment.lookup.ts';

/**
 * The consumer's contract, minus the database.
 *
 * What these prove: the envelope switch routes every known type, unknown types and missing
 * identity are ignored (never fatal), unparseable payloads are malformed (never fatal), and
 * the projection carries the right per-shipment rows in order. Dedupe atomicity is proven by
 * test/integration/, against Postgres.
 */

function message(type: string, data: Record<string, unknown>, aggregateType = 'x') {
  return {
    subject: `zipzap.test.${type.toLowerCase()}`,
    payload: new TextEncoder().encode(
      JSON.stringify({
        id: 'evt-1',
        type,
        aggregateType,
        aggregateId: 'a-1',
        occurredAt: new Date().toISOString(),
        data,
      }),
    ),
  };
}

describe('TrackingConsumer dispatch', () => {
  let consumer: TrackingConsumer;
  let projected: { trackingCode: string; shipmentId: string; eventType: string }[];

  beforeEach(async () => {
    projected = [];
    const lookup: ShipmentLookup = {
      findTrackingCode: vi.fn(async (shipmentId: string) =>
        shipmentId === 'missing' ? null : `ZP-${shipmentId.slice(0, 8).toUpperCase()}`,
      ),
    } as unknown as ShipmentLookup;

    const trackingDs = {
      transaction: (fn: (manager: unknown) => Promise<unknown>) =>
        fn({
          query: async (sql: string, params: unknown[]) => {
            const paramsArray = params as unknown[];
            if (sql.includes('MAX(sequence)')) return [{ next: projected.length + 1 }];
            if (sql.includes('consumed_events')) return [{ event_id: 'evt-1' }];
            if (!sql.includes('public_timeline')) return [];
            // INSERT binds (id, tracking_code, shipment_id, sequence, event_type, occurred_at).
            projected.push({
              trackingCode: String(paramsArray[1]),
              shipmentId: String(paramsArray[2]),
              eventType: String(paramsArray[4]),
            });
            return [];
          },
        }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingConsumer,
        { provide: SHIPMENT_LOOKUP, useValue: lookup },
        { provide: 'trackingDataSource', useValue: trackingDs },
      ],
    })
      .useMocker(() => ({}))
      .compile()
      .catch(() => null as unknown as TestingModule);

    if (module) {
      consumer = module.get(TrackingConsumer);
    } else {
      consumer = new TrackingConsumer(trackingDs as never, lookup);
    }
  });

  it('routes ShipmentCreated to one SHIPMENT_CREATED row', async () => {
    const outcome = await consumer.handle(
      message('ShipmentCreated', { trackingCode: 'ZP-IGNORED', shipmentId: 's-1' }),
    );
    // Consumer derives the code via the lookup, not the payload field — so the fake lookup
    // above resolves s-1, and the payload's stale trackingCode is correctly unused.
    expect(['processed', 'duplicate']).toContain(outcome);
    expect(projected).toHaveLength(1);
    expect(projected[0]!.shipmentId).toBe('s-1');
    expect(projected[0]!.eventType).toBe('SHIPMENT_CREATED');
  });

  it('projects one PICKUP_ASSIGNED row per member shipment', async () => {
    const outcome = await consumer.handle(
      message('PickupAssigned', { shipmentIds: ['s-1', 's-2'] }),
    );
    expect(['processed', 'duplicate']).toContain(outcome);
    expect(projected).toHaveLength(2);
    expect(projected.map((p) => p.eventType)).toEqual(['PICKUP_ASSIGNED', 'PICKUP_ASSIGNED']);
  });

  it('projects its own aggregate id when the payload names no parcel', async () => {
    const outcome = await consumer.handle(
      message('ShipmentCreated', { trackingCode: 'ZP-IGNORED' }, 'shipment'),
    );
    // data.shipmentId absent entirely; the fallback resolves aggregateId via the lookup.
    expect(['processed', 'duplicate']).toContain(outcome);
    expect(projected).toHaveLength(1);
    expect(projected[0]!.shipmentId).toBe('a-1');
  });

  it('ignores unknown types, missing identity, SILENT types, and malformed payloads', async () => {
    expect(await consumer.handle(message('SomethingElseHappened', { shipmentId: 's-1' }))).toBe(
      'ignored',
    );
    expect(await consumer.handle(message('DeliveryOutForDelivery', {}))).toBe('ignored');
    expect(await consumer.handle(message('DeliveryJobCreated', { shipmentId: 's-1' }))).toBe(
      'ignored',
    );
    expect(
      await consumer.handle({ subject: 'x', payload: new TextEncoder().encode('{nope') }),
    ).toBe('malformed');
    expect(projected).toHaveLength(0);
  });

  it('skips unresolvable shipment ids without failing the batch', async () => {
    const outcome = await consumer.handle(
      message('PickupAssigned', { shipmentIds: ['missing', 's-1'] }),
    );
    expect(['processed', 'duplicate']).toContain(outcome);
    expect(projected).toHaveLength(1);
    expect(projected[0]!.shipmentId).toBe('s-1');
  });
});
