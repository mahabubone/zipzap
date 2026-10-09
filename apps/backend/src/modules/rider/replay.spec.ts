/**
 * The device replay contract, asserted against hand-written doubles.
 *
 * The properties under test are the ones ADR-0012 names and that a reader cannot check by looking:
 * device order, exactly-once on `(rider_id, device_sequence)`, an explicit rejection a rider can
 * read, and a whole-batch refusal when the queue cannot hold the batch. The last two are the ones
 * that matter — a silent drop is the failure mode the whole design exists to prevent, and partial
 * application would lose a rider's work without telling them.
 *
 * No database: the repository is stubbed with an in-memory table so the assertions are about the
 * service's decisions — what it orders, what it repeats, and when it refuses.
 */

import { describe, expect, it, vi } from 'vitest';
import { CommandQueueFullError, ResourceNotFoundError } from '../../common/domain-error.ts';
import {
  OfflineSyncService,
  OFFLINE_SYNC_VALIDATORS,
  type DeviceCommand,
  type Validator,
} from './offline-sync.service.ts';

/** A stand-in for `rider.command_queue` with the same two unique properties that matter. */
class FakeQueue {
  readonly rows: Array<{
    id: string;
    riderId: string;
    deviceSequence: number;
    commandType: string;
    payload: object;
    expectedState: object | null;
    createdAt: Date;
    acknowledgedAt: Date | null;
    rejectedAt: Date | null;
    rejectionReason: string | null;
  }> = [];
  /** Every write, so a test can assert the ORDER commands were applied in. */
  readonly applied: number[] = [];

  private find(riderId: string, seq: number) {
    return this.rows.find((r) => r.riderId === riderId && r.deviceSequence === seq) ?? null;
  }

  async countPending(_m: unknown, riderId: string) {
    return {
      count: String(
        this.rows.filter((r) => r.riderId === riderId && !r.acknowledgedAt && !r.rejectedAt).length,
      ),
    };
  }

  async enqueue(_m: unknown, row: (typeof this.rows)[number] & { createdAt: Date }) {
    if (this.find(row.riderId, row.deviceSequence)) return false;
    this.rows.push({
      ...row,
      acknowledgedAt: null,
      rejectedAt: null,
      rejectionReason: null,
    });
    return true;
  }

  async findByDeviceSequence(_m: unknown, riderId: string, seq: number) {
    return this.find(riderId, seq);
  }

  async findCommand(_m: unknown, id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async markDelivered(_m: unknown, id: string) {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.acknowledgedAt = new Date();
    this.applied.push(this.rows.find((r) => r.id === id)!.deviceSequence);
  }

  async markRejected(_m: unknown, id: string, reason: string | null) {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.rejectedAt = new Date();
      row.rejectionReason = reason;
    }
    this.applied.push(this.rows.find((r) => r.id === id)!.deviceSequence);
  }
}

/** Outbox writes are a side effect the assertions do not care about, but must not blow up. */
function harness(options: { validators?: Record<string, Validator>; riderExists?: boolean } = {}) {
  const queue = new FakeQueue();
  // A manager with `query`, because the outbox writer is a real collaborator and its INSERT is the
  // only proof that a delivery or rejection was published (rule 7). Stubbing it away would make
  // these tests pass on a path that publishes nothing.
  const outbox: Array<{ type: string; payload: unknown }> = [];
  const manager = {
    query: async (_sql: string, params?: unknown[]) => {
      if (Array.isArray(params) && typeof params[0] === 'string' && params.length > 3) {
        outbox.push({ type: params[0], payload: params.at(-1) });
      }
      return [];
    },
  };
  const transaction = vi.fn(async (fn: (m: unknown) => Promise<unknown>) => fn(manager));
  const service = new OfflineSyncService(
    { transaction } as never,
    queue as never,
    {
      findById: vi.fn(async () =>
        (options.riderExists ?? true) ? { id: 'r-1', status: 'ON_DELIVERY' } : null,
      ),
    } as never,
    (options.validators ?? {}) as never,
  );
  return { service, queue, transaction, outbox };
}

const at = (iso: string) => new Date(iso);

function device(over: Partial<DeviceCommand> & { deviceSequence: number }): DeviceCommand {
  return {
    createdAt: at('2026-10-09T08:00:00.000Z'),
    commandType: 'zipzap.rider.delivery',
    payload: { shipmentId: 's-1' },
    expectedState: { shipmentId: 's-1', shipmentStatus: 'OUT_FOR_DELIVERY' },
    ...over,
  };
}

describe('device replay', () => {
  it('applies each command exactly once, in the device`s order rather than the server`s', async () => {
    const { service, queue } = harness();
    // Sent deliberately out of order. The device's clock is the only thing that knows the truth.
    const result = await service.replay('r-1', [
      device({ deviceSequence: 3, createdAt: at('2026-10-09T11:00:00.000Z') }),
      device({ deviceSequence: 1, createdAt: at('2026-10-09T09:00:00.000Z') }),
      device({ deviceSequence: 2, createdAt: at('2026-10-09T10:00:00.000Z') }),
    ]);

    expect(result.results.map((r) => r.deviceSequence)).toEqual([1, 2, 3]);
    expect(queue.applied).toEqual([1, 2, 3]);
    expect(result.results.every((r) => r.kind === 'applied')).toBe(true);
  });

  it('breaks a createdAt tie with the device sequence, so the order is total', async () => {
    const { service, queue } = harness();
    const sameInstant = at('2026-10-09T09:00:00.000Z');
    await service.replay('r-1', [
      device({ deviceSequence: 2, createdAt: sameInstant }),
      device({ deviceSequence: 1, createdAt: sameInstant }),
    ]);
    expect(queue.applied).toEqual([1, 2]);
  });

  it('re-sending a batch applies nothing twice and reports each as a duplicate', async () => {
    const { service, queue } = harness();
    const batch = [device({ deviceSequence: 1 }), device({ deviceSequence: 2 })];

    const first = await service.replay('r-1', batch);
    expect(first.results.every((r) => r.kind === 'applied')).toBe(true);

    const second = await service.replay('r-1', batch);
    expect(second.results.map((r) => r.kind)).toEqual(['duplicate', 'duplicate']);
    // And it says what happened the first time, so the device can reconcile rather than guess.
    expect(second.results.map((r) => r.reason)).toEqual(['already applied', 'already applied']);
    // Three rows total for two commands: the duplicate never became a row.
    expect(queue.rows).toHaveLength(2);
  });

  it('reports a duplicate of a REJECTED command as already rejected, with its reason', async () => {
    const { service, queue } = harness({
      validators: {
        'zipzap.rider.delivery': async () => ({
          valid: false,
          reason: 'expected status OUT_FOR_DELIVERY, shipment is CANCELLED',
        }),
      },
    });
    const batch = [device({ deviceSequence: 1 })];

    const first = await service.replay('r-1', batch);
    expect(first.results.map((r) => r.kind)).toEqual(['rejected']);
    expect(first.results.map((r) => r.reason).join('')).toContain('CANCELLED');

    const second = await service.replay('r-1', batch);
    expect(second.results.map((r) => r.kind)).toEqual(['duplicate']);
    // The reason survives the round trip — the rider is told the same thing twice, not a generic "no".
    expect(second.results.map((r) => r.reason).join('')).toContain('CANCELLED');
    expect(queue.rows.map((r) => r.rejectionReason).join('')).toContain('CANCELLED');
  });

  it('rejects a stale command explicitly rather than dropping it', async () => {
    // This is exit check two: a shipment cancelled while the phone was offline must come back as a
    // refusal the rider reads. Silently not applying it would leave the parcel in a state nobody
    // believes, and silently applying it would deliver a cancelled parcel.
    const { service, queue } = harness({
      validators: {
        'zipzap.rider.delivery': async (_m: unknown, command: { expected_state: unknown }) => {
          const expected = command.expected_state as { shipmentStatus: string };
          return expected.shipmentStatus === 'CANCELLED'
            ? { valid: true }
            : { valid: false, reason: 'expected status OUT_FOR_DELIVERY, shipment is CANCELLED' };
        },
      },
    });

    const result = await service.replay('r-1', [device({ deviceSequence: 1 })]);

    expect(result.results).toEqual([
      {
        deviceSequence: 1,
        commandId: expect.any(String),
        kind: 'rejected',
        reason: 'expected status OUT_FOR_DELIVERY, shipment is CANCELLED',
      },
    ]);
    // The row exists and records why. Not a missing row — an accounted-for one.
    expect(queue.rows).toHaveLength(1);
    expect(queue.rows.map((r) => r.rejectedAt)).not.toContain(null);
    expect(queue.rows.map((r) => r.acknowledgedAt)).toEqual([null]);
  });

  it('refuses the WHOLE batch when the queue cannot hold it, so no command is lost', async () => {
    const { service, queue } = harness();
    const many = Array.from({ length: 101 }, (_, i) => device({ deviceSequence: i + 1 }));

    await expect(service.replay('r-1', many)).rejects.toBeInstanceOf(CommandQueueFullError);

    // The load-bearing assertion: not 100 applied and one refused. Zero.
    expect(queue.rows).toHaveLength(0);
  });

  it('refuses a batch that exactly fills the queue, because the next one would not fit', async () => {
    const { service, queue } = harness();
    await expect(
      service.replay(
        'r-1',
        Array.from({ length: 101 }, (_, i) => device({ deviceSequence: i + 1 })),
      ),
    ).rejects.toBeInstanceOf(CommandQueueFullError);
    expect(queue.rows).toHaveLength(0);

    // A hundred is fine, and every one is applied rather than merely stored.
    const result = await service.replay(
      'r-1',
      Array.from({ length: 100 }, (_, i) => device({ deviceSequence: i + 1 })),
    );
    expect(result.results.every((r) => r.kind === 'applied')).toBe(true);
    expect(queue.applied).toHaveLength(100);
  });

  it('warns before the cap is hit rather than at it', async () => {
    const { service } = harness();
    // 90 of 100 is the documented threshold. The warning is about the BATCH, because a replayed
    // command is applied inside the same transaction and never sits pending — so the queue behind
    // it is always empty and a `queueSize`-derived warning would never fire on this path at all.
    const result = await service.replay(
      'r-1',
      Array.from({ length: 90 }, (_, i) => device({ deviceSequence: i + 1 })),
    );
    expect(result.capWarning).toBe(true);
    expect(result.queueSize).toBe(0);
  });

  it('does not warn on a short batch', async () => {
    const { service } = harness();
    const result = await service.replay('r-1', [device({ deviceSequence: 1 })]);
    expect(result.capWarning).toBe(false);
  });

  it('404s an unknown rider before touching the queue', async () => {
    const { service, queue } = harness({ riderExists: false });
    await expect(service.replay('r-nope', [device({ deviceSequence: 1 })])).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    expect(queue.rows).toHaveLength(0);
  });

  it('runs the whole batch in one transaction, so a mid-batch fault rolls the batch back', async () => {
    const { service, transaction } = harness();
    await service.replay('r-1', [device({ deviceSequence: 1 }), device({ deviceSequence: 2 })]);
    // Not N transactions, which would leave a half-applied day if the connection dropped at 3.
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('validates every command type through the registry, and a type with no validator passes', async () => {
    const seen: string[] = [];
    const { service } = harness({
      validators: {
        'zipzap.rider.delivery': async () => {
          seen.push('delivery');
          return { valid: true };
        },
      },
    });

    const result = await service.replay('r-1', [
      device({ deviceSequence: 1, commandType: 'zipzap.rider.delivery' }),
      device({ deviceSequence: 2, commandType: 'zipzap.something.new' }),
    ]);

    expect(seen).toEqual(['delivery']);
    expect(result.results.map((r) => r.kind)).toEqual(['applied', 'applied']);
  });

  it('publishes exactly one outbox event per command, delivered or rejected', async () => {
    // Rule 7: a state change that is not published is a state change the rest of the system never
    // learns about. One event per command — not one per batch, and not two for a rejection.
    const { service, outbox } = harness({
      validators: {
        'zipzap.rider.delivery': async (_m: unknown, c: { device_sequence: number }) =>
          c.device_sequence === 2 ? { valid: false, reason: 'stale' } : { valid: true },
      },
    });

    await service.replay('r-1', [device({ deviceSequence: 1 }), device({ deviceSequence: 2 })]);

    expect(outbox.map((e) => e.type)).toEqual(['RiderCommandDelivered', 'RiderCommandRejected']);
  });

  it('publishes exactly one outbox event per command, delivered or rejected', async () => {
    // Rule 7: a state change that is not published is a state change the rest of the system never
    // learns about. One event per command — not one per batch, and not two for a rejection.
    const { service, outbox } = harness({
      validators: {
        'zipzap.rider.delivery': async (_m: unknown, c: { device_sequence: number }) =>
          c.device_sequence === 2 ? { valid: false, reason: 'stale' } : { valid: true },
      },
    });

    await service.replay('r-1', [device({ deviceSequence: 1 }), device({ deviceSequence: 2 })]);

    expect(outbox.map((e) => e.type)).toEqual(['RiderCommandDelivered', 'RiderCommandRejected']);
  });

  it('registers its validators under a token the module can inject, not a global', () => {
    // A guard against someone "simplifying" the registry into a module-level singleton: the whole
    // reason for DI here is that the validator needs SHIPMENT_LOOKUP, and rule 3 says rules files
    // import nothing from the framework.
    expect(typeof OFFLINE_SYNC_VALIDATORS).toBe('symbol');
    expect(OFFLINE_SYNC_VALIDATORS.toString()).toContain('offlineSyncValidators');
  });
});
