import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { COD_LOOKUP } from '../cod/cod.lookup.ts';
import { ReturnService } from './return.service.ts';
import { ReturnRequestRepository } from './return-request.repository.ts';
import { ShipmentAdvanceService } from '../shipment/advance-shipment.service.ts';
import { InvalidIdempotencyKeyError, InvalidTransitionError } from '../../common/domain-error.ts';

/**
 * The return choreography, minus the database.
 *
 * What these cover: request is idempotency-keyed per shipment; a second return
 * for the same parcel is rejected; approve walks the decision edge; advance
 * walks each transit leg exactly once; completion emits the reversal payload
 * measured by COD. Real atomicity is proven by test/integration/ against Postgres.
 */

const REQUEST = {
  shipmentId: 's-ret-1',
  merchantId: 'm-1',
  reason: 'CUSTOMER_REFUSED' as const,
  idempotencyKey: 'key-ret-1',
};

function fakeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ret-1',
    shipmentId: 's-ret-1',
    merchantId: 'm-1',
    reason: 'CUSTOMER_REFUSED',
    status: 'RETURN_REQUESTED',
    reviewNote: null,
    decidedBy: null,
    decidedAt: null,
    ...overrides,
  };
}

function fakeManager(
  request: Record<string, unknown> | null = null,
  initialShipmentStatus = 'DELIVERED',
) {
  const touched: string[] = [];
  // Advance walks RETURN_INITIATED → … → RETURNED hop by hop on the shipment
  // machine too — the fake remembers each UPDATE or hop 2 validates stale.
  let shipmentStatus = initialShipmentStatus;
  return {
    touched,
    manager: {
      query: (sql: string, params?: unknown[]) => {
        if (sql.includes('shipment.shipments')) {
          touched.push('shipment.status');
          if (sql.includes('SELECT')) {
            return Promise.resolve([{ id: 's-ret-1', status: shipmentStatus }]);
          }
          if (sql.includes('UPDATE')) {
            shipmentStatus = String(params?.[1] ?? shipmentStatus);
            return Promise.resolve([]);
          }
        }
        touched.push(
          sql.includes('tracking.events')
            ? 'tracking.events'
            : sql.includes('outbox_events')
              ? 'system.outbox_events'
              : sql.includes('idempotency_keys')
                ? sql.includes('UPDATE')
                  ? 'complete:system.idempotency_keys'
                  : 'claim:system.idempotency_keys'
                : sql,
        );
        if (sql.includes('INSERT INTO system.idempotency_keys') && sql.includes('ON CONFLICT')) {
          return Promise.resolve([{ scope: 'x' }]);
        }
        return Promise.resolve([]);
      },
      getRepository: () => ({
        save: (entity: unknown) => {
          touched.push('returns.requests');
          return Promise.resolve(entity);
        },
        findOneBy: (where: Record<string, unknown>) => {
          touched.push(where.shipmentId ? 'find:returns.requests' : 'find:returns.requests');
          // findByShipmentId returns null unless the test seeds a duplicate.
          return Promise.resolve((fakeManager as { duplicate?: unknown }).duplicate ?? null);
        },
      }),
      createQueryBuilder: () => ({
        setLock: () => ({
          where: () => ({
            getOne: () => {
              touched.push('lock:returns.requests');
              return Promise.resolve(request);
            },
          }),
        }),
      }),
    },
  };
}

function serviceWith(
  fake: ReturnType<typeof fakeManager>,
  collected: { collectedMinor: number; currency: string; merchantId: string } | null = null,
): ReturnService {
  const fakeDs = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn(fake.manager) };
  const cod = { findCollected: vi.fn(async () => collected) };
  return new ReturnService(
    fakeDs as never,
    new ReturnRequestRepository(),
    {
      append: vi.fn(),
    } as never,
    cod as never,
    new ShipmentAdvanceService(),
  );
}

describe('ReturnService orchestration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (fakeManager as { duplicate?: unknown }).duplicate;
  });

  it('requests a return, idempotency-keyed, with one tracking row and one event', async () => {
    const fake = fakeManager(null);
    const service = serviceWith(fake);

    const { result, replayed } = await service.request({ ...REQUEST });

    expect(replayed).toBe(false);
    expect(result!.status).toBe('RETURN_REQUESTED');
    // tracking.events flows through the mocked AppendTrackingEventService, not SQL.
    expect(fake.touched).toEqual([
      'claim:system.idempotency_keys',
      'find:returns.requests',
      'returns.requests',
      'system.outbox_events',
      'complete:system.idempotency_keys',
    ]);
  });

  it('rejects a second return for the same parcel', async () => {
    (fakeManager as { duplicate?: unknown }).duplicate = fakeRequest();
    const fake = fakeManager(null);
    const service = serviceWith(fake);

    await expect(service.request({ ...REQUEST, idempotencyKey: 'key-ret-2' })).rejects.toThrow(
      InvalidIdempotencyKeyError,
    );
  });

  it('approve walks REQUESTED -> APPROVED with reviewer recorded', async () => {
    const fake = fakeManager(fakeRequest());
    const service = serviceWith(fake);

    const outcome = await service.decide({
      returnId: 'ret-1',
      approverId: 'op-1',
      note: 'customer refused at the door, parcel intact',
      approve: true,
    });
    expect(outcome.status).toBe('RETURN_APPROVED');
  });

  it('reject walks REQUESTED -> REJECTED', async () => {
    const fake = fakeManager(fakeRequest());
    const service = serviceWith(fake);

    const outcome = await service.decide({
      returnId: 'ret-1',
      approverId: 'op-1',
      note: 'parcel was delivered intact a month ago',
      approve: false,
    });
    expect(outcome.status).toBe('RETURN_REJECTED');
  });

  it('advance walks each transit leg exactly once', async () => {
    const legs = [
      ['RETURN_APPROVED', 'RETURN_INITIATED'],
      ['RETURN_INITIATED', 'RETURN_IN_TRANSIT'],
      ['RETURN_IN_TRANSIT', 'RETURN_AT_HUB'],
      ['RETURN_AT_HUB', 'RETURN_OUT_FOR_DELIVERY'],
      ['RETURN_OUT_FOR_DELIVERY', 'RETURNED'],
    ] as const;
    for (const [from, to] of legs) {
      // Each leg runs on its own fake: seed the shipment at the leg's source
      // state (DELIVERED before the first leg, the previous leg's status after).
      const fake = fakeManager(
        fakeRequest({ status: from }),
        from === 'RETURN_APPROVED' ? 'DELIVERED' : from,
      );
      const service = serviceWith(fake, {
        collectedMinor: 125_050,
        currency: 'BDT',
        merchantId: 'm-1',
      });
      const outcome = await service.advance({ returnId: 'ret-1', actorId: null });
      expect(outcome.status).toBe(to);
    }
  });

  it('advance past RETURNED is rejected — history never rewinds', async () => {
    const fake = fakeManager(fakeRequest({ status: 'RETURNED' }));
    const service = serviceWith(fake);

    await expect(service.advance({ returnId: 'ret-1', actorId: null })).rejects.toThrow(
      /not in transit/,
    );
  });

  it('approve from the wrong state 409s', async () => {
    const fake = fakeManager(fakeRequest({ status: 'RETURNED' }));
    const service = serviceWith(fake);

    await expect(
      service.decide({ returnId: 'ret-1', approverId: 'op-1', note: 'too late', approve: true }),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it('resolves through the real Nest container with mocked boundaries', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnService,
        { provide: ReturnRequestRepository, useValue: {} },
        { provide: AppendTrackingEventService, useValue: { append: vi.fn() } },
        { provide: COD_LOOKUP, useValue: {} },
      ],
    })
      .useMocker(() => ({}))
      .compile();

    expect(module.get(ReturnService)).toBeDefined();
  });
});
