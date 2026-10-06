import { describe, expect, it, beforeEach, vi } from 'vitest';
import { CommandQueueFullError, ResourceNotFoundError } from '../../common/domain-error.ts';
import { OfflineSyncService } from './offline-sync.service.ts';

function fakeCommand(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q-1',
    riderId: 'r-1',
    deviceSequence: 1,
    commandType: 'zipzap.rider.command',
    payload: {},
    expectedState: null,
    acknowledgedAt: null,
    rejectedAt: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function fakeQueue(rows: Partial<typeof fakeCommand>[], atCap: boolean) {
  return {
    findPendingCommands: vi.fn().mockResolvedValue(rows),
    countPending: vi.fn().mockImplementation(async () => ({
      count: String(atCap ? 100 : rows.length),
    })),
    findCommand: vi.fn().mockImplementation(async (_m: unknown, commandId: string) => {
      if (commandId === 'q-1') return rows[0];
      return null;
    }),
    enqueue: vi.fn().mockResolvedValue(undefined),
    markDelivered: vi.fn().mockResolvedValue(undefined),
    markRejected: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeRiders(found: boolean) {
  return {
    findById: vi.fn().mockResolvedValue(found ? { id: 'r-1', status: 'ON_PICKUP' } : null),
  };
}

function fakeDs(rows: Partial<typeof fakeCommand>[], atCap: boolean) {
  const manager = {
    query: (sql: string) => {
      if (sql.includes('INSERT INTO system.idempotency_keys') && sql.includes('ON CONFLICT')) {
        return [{ scope: 'x' }];
      }
      if (sql.includes('INSERT INTO rider.command_queue')) return [{ affected: 1 }];
      if (sql.includes('SELECT COUNT')) return [{ count: String(atCap ? 100 : rows.length) }];
      return [];
    },
    getRepository: vi.fn(),
  };
  return {
    transaction: async (fn: (m: unknown) => Promise<unknown>) => fn(manager),
    manager,
  };
}

function serviceWith(
  rows: Partial<typeof fakeCommand>[] = [fakeCommand()],
  atCap = false,
  ridersFound = true,
  validators = {},
) {
  const ds = fakeDs(rows, atCap);
  const queue = fakeQueue(rows, atCap);
  return {
    ds,
    queue,
    service: new OfflineSyncService(
      ds as never,
      queue as never,
      fakeRiders(ridersFound) as never,
      validators as any,
    ),
  };
}

describe('offline sync service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('pulls pending commands in created_at order', async () => {
    const later = new Date('2026-01-01T00:00:02Z');
    const { service } = serviceWith([
      fakeCommand({ id: 'q-1', created_at: new Date('2026-01-01T00:00:00Z') }),
      fakeCommand({ id: 'q-2', created_at: later }),
    ]);

    const result = await service.pull('r-1');

    expect(result.commands.map((c) => c.id)).toEqual(['q-1', 'q-2']);
    expect(result.queueSize).toBe(2);
    expect(result.capWarning).toBe(false);
  });

  it('warns when the pending queue exceeds 90% of the cap', async () => {
    const { service } = serviceWith([fakeCommand()], true);

    const result = await service.pull('r-1');

    expect(result.queueSize).toBe(100);
    expect(result.capWarning).toBe(true);
  });

  it('enqueues and rejects at cap', async () => {
    const { service, queue } = serviceWith([fakeCommand()], true);

    await expect(service.enqueue('r-1', 99, 'zipzap.rider.command', { x: 1 })).rejects.toThrow(
      CommandQueueFullError,
    );

    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues within capacity', async () => {
    const { service, queue } = serviceWith([fakeCommand()], false);

    await service.enqueue('r-1', 2, 'zipzap.rider.command', { x: 1 });

    expect(queue.enqueue).toHaveBeenCalled();
  });

  it('acknowledges an unvalidated command as delivered and emits the outbox event', async () => {
    const { service, queue } = serviceWith();

    const result = await service.acknowledge('q-1', 'r-1', 'k-1', { commandId: 'q-1' });

    expect(queue.markDelivered).toHaveBeenCalledWith(expect.any(Object), 'q-1');
    expect(result.outcome).toEqual({ kind: 'delivered', replayed: false });
  });

  it('rejects when expected_state.status does not match current rider status', async () => {
    const validator = async (_: unknown, command: { expected_state: { status: string } }) => {
      expect(command.expected_state?.status).toBe('AVAILABLE');
      return { valid: false, reason: 'rider status is ON_PICKUP, expected AVAILABLE' };
    };
    const row = fakeCommand({ expectedState: { status: 'AVAILABLE' } });
    const { service, queue } = serviceWith([row], false, true, {
      'zipzap.rider.command': validator,
    });

    const result = await service.acknowledge('q-1', 'r-1', 'k-1', { commandId: 'q-1' });

    expect(queue.markRejected).toHaveBeenCalledWith(
      expect.any(Object),
      'q-1',
      'rider status is ON_PICKUP, expected AVAILABLE',
    );
    expect(result.outcome).toEqual({ kind: 'rejected', replayed: false });
  });

  it('replays an already-acked command', async () => {
    const row = fakeCommand({
      acknowledgedAt: new Date(),
      created_at: new Date('2026-01-01T00:00:00Z'),
    });
    const { service, queue } = serviceWith([row], false, true, {
      'zipzap.rider.command': async () => {
        throw new Error('validator must not run for acked commands');
      },
    });

    const result = await service.acknowledge('q-1', 'r-1', 'k-1', { commandId: 'q-1' });

    expect(queue.markDelivered).not.toHaveBeenCalled();
    expect(result.outcome).toEqual({ kind: 'already_delivered', replayed: true });
  });

  it('replays a rejected command as already_rejected', async () => {
    const row = fakeCommand({
      rejectedAt: new Date(),
      created_at: new Date('2026-01-01T00:00:00Z'),
    });
    const { service, queue } = serviceWith([row], false, true, {
      'zipzap.rider.command': async () => {
        throw new Error('validator must not run for rejected commands');
      },
    });

    const result = await service.acknowledge('q-1', 'r-1', 'k-1', { commandId: 'q-1' });

    expect(queue.markRejected).not.toHaveBeenCalled();
    expect(result.outcome).toEqual({ kind: 'already_rejected', replayed: true });
  });

  it('returns 404 when the command does not exist', async () => {
    const { service } = serviceWith([], false, true, {});

    await expect(
      service.acknowledge('missing', 'r-1', 'k-1', { commandId: 'missing' }),
    ).rejects.toThrow(ResourceNotFoundError);
  });

  it('returns 404 when the rider does not exist', async () => {
    const { service } = serviceWith([], false, false, {});

    await expect(service.pull('missing')).rejects.toThrow(ResourceNotFoundError);
  });
});
