import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HoldReleaseService } from './hold-release.service.ts';
import { ShipmentRepository } from './shipment.repository.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { InvalidTransitionError } from '../../common/domain-error.ts';

/**
 * Hold/release orchestration, minus the databases.
 *
 * The state machine's ON_HOLD round-trip is covered exhaustively in
 * state-machine.spec.ts. Here we prove the service uses it: hold records the
 * interrupted state, release restores it exactly, and every legal move writes
 * its tracking event and outbox row first — never a silent status UPDATE.
 */

function fakeDsWith(touched: string[]) {
  return {
    transaction: (fn: (m: unknown) => Promise<unknown>) =>
      fn({
        query: (sql: string) => {
          touched.push(
            sql.includes('tracking.events')
              ? 'tracking.events'
              : sql.includes('outbox_events')
                ? 'system.outbox_events'
                : sql,
          );
          return Promise.resolve([]);
        },
        getRepository: () => ({
          save: (entity: unknown) => {
            touched.push('shipment.shipments');
            return Promise.resolve(entity);
          },
        }),
      }),
  };
}

function shipmentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 's-1',
    trackingCode: 'ZP-ABC123',
    merchantId: 'm-1',
    status: 'OUT_FOR_DELIVERY',
    heldFromStatus: null,
    ...overrides,
  };
}

describe('HoldReleaseService', () => {
  let trackingAppend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    trackingAppend = vi.fn(async () => undefined);
  });

  function make(row: Record<string, unknown> | null, touched: string[]) {
    const shipments = {
      findByIdForUpdate: vi.fn(async () => row),
      save: vi.fn(async (_m: unknown, e: unknown) => e),
    } as unknown as ShipmentRepository;
    const tracking = { append: trackingAppend } as unknown as AppendTrackingEventService;
    return new HoldReleaseService(fakeDsWith(touched) as never, shipments, tracking);
  }

  it('hold pauses an interruptible state and records where to resume', async () => {
    const row = shipmentRow();
    const touched: string[] = [];
    const service = make(row, touched);

    const result = await service.hold({
      shipmentId: 's-1',
      reason: 'address dispute',
      actorId: null,
    });

    expect(result.status).toBe('ON_HOLD');
    expect(row.status).toBe('ON_HOLD');
    expect(row.heldFromStatus).toBe('OUT_FOR_DELIVERY');
    expect(trackingAppend).toHaveBeenCalledOnce();
    expect((trackingAppend.mock.calls[0]![1] as { eventType: string }).eventType).toBe(
      'SHIPMENT_HELD',
    );
    expect(touched).toContain('system.outbox_events');
  });

  it('hold from IN_TRANSIT is a 409 — a moving parcel has no hold gesture', async () => {
    const row = shipmentRow({ status: 'IN_TRANSIT' });
    const touched: string[] = [];
    const service = make(row, touched);

    await expect(service.hold({ shipmentId: 's-1', reason: null, actorId: null })).rejects.toThrow(
      InvalidTransitionError,
    );
    expect(row.status).toBe('IN_TRANSIT');
    expect(touched).not.toContain('system.outbox_events');
  });

  it('release resumes exactly the state hold interrupted', async () => {
    const row = shipmentRow({ status: 'ON_HOLD', heldFromStatus: 'OUT_FOR_DELIVERY' });
    const touched: string[] = [];
    const service = make(row, touched);

    const result = await service.release({ shipmentId: 's-1', actorId: null });

    expect(result.status).toBe('OUT_FOR_DELIVERY');
    expect(row.status).toBe('OUT_FOR_DELIVERY');
    expect(row.heldFromStatus).toBeNull();
    expect(trackingAppend).toHaveBeenCalledOnce();
    expect((trackingAppend.mock.calls[0]![1] as { eventType: string }).eventType).toBe(
      'SHIPMENT_RELEASED',
    );
  });

  it('release on a non-held shipment is a 409 INVALID_TRANSITION, no writes', async () => {
    const row = shipmentRow();
    const touched: string[] = [];
    const service = make(row, touched);

    await expect(service.release({ shipmentId: 's-1', actorId: null })).rejects.toThrow(
      InvalidTransitionError,
    );
    expect(touched).not.toContain('system.outbox_events');
    expect(trackingAppend).not.toHaveBeenCalled();
  });
});
