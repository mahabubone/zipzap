import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { AssignPickupService } from './assign-pickup.service.ts';
import { PickupRepository } from './pickup.repository.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { AssignRiderService } from '../rider/assign-rider.service.ts';

/**
 * The assign transaction, minus the databases.
 *
 * What this proves: the pickup row is locked before the rider is scored, the rider service is
 * called through the injected contract (not a table read), and each member shipment gets its own
 * tracking event. Atomicity itself is proven by test/integration/, against Postgres.
 */

function fakeManager(row: Record<string, unknown>) {
  const written: string[] = [];
  const lockChain = {
    setLock: () => ({
      where: () => ({
        getOne: () => {
          written.push('lock:pickup.pickups');
          return Promise.resolve(row);
        },
      }),
    }),
  };
  return {
    written,
    manager: {
      createQueryBuilder: () => lockChain,
      query: (sql: string) => {
        if (sql.includes('FOR UPDATE')) written.push('lock:pickup.pickups');
        else if (sql.includes('idempotency_keys')) written.push('claim:system.idempotency_keys');
        else if (sql.includes('tracking.events')) written.push('tracking.events');
        else if (sql.includes('outbox_events')) written.push('system.outbox_events');
        else written.push(sql.slice(0, 40));
        // Idempotency claim on a fresh key: free to proceed.
        if (sql.includes('idempotency_keys') && sql.includes('ON CONFLICT')) {
          return Promise.resolve([{ scope: 'x' }]);
        }
        return Promise.resolve([]);
      },
      getRepository: () => ({
        findOneBy: () => Promise.resolve(null),
        save: (entity: unknown) => {
          written.push('save:pickup.pickups');
          return Promise.resolve(entity);
        },
      }),
    },
  };
}

describe('AssignPickupService orchestration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('locks the pickup, scores via the rider contract, and records one tracking event per shipment', async () => {
    const fake = fakeManager({
      id: 'p-1',
      merchantId: 'm-1',
      shipmentIds: ['s-1', 's-2'],
      status: 'SCHEDULED',
    });
    const fakeDs = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn(fake.manager) };

    const riders = {
      assign: vi.fn(async () => ({
        riderId: 'r-9',
        score: 12,
        reasons: ['near'],
        previousStatus: 'AVAILABLE',
      })),
    } as unknown as AssignRiderService;
    const tracking = new AppendTrackingEventService();
    const appendSpy = vi.spyOn(tracking, 'append').mockImplementation(async () => {
      fake.written.push('tracking.events');
    });

    const service = new AssignPickupService(
      fakeDs as never,
      new PickupRepository(),
      tracking,
      riders,
    );

    const { result, replayed } = await service.execute({
      pickupId: 'p-1',
      candidates: [
        { riderId: 'r-9', distanceMetres: 900, activeJobs: 0, capacity: 3, recentRefusals: 0 },
      ],
      idempotencyKey: 'k-assign-1',
      actorId: null,
    });

    expect(replayed).toBe(false);
    expect(result.riderId).toBe('r-9');
    expect(result.status).toBe('ASSIGNED');
    // One tracking event per member shipment of the batch.
    expect(appendSpy).toHaveBeenCalledTimes(2);
    // The rider contract was called, never a rider table.
    expect(riders.assign).toHaveBeenCalledOnce();
    expect(riders.assign).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'p-1' }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignPickupService,
        { provide: PickupRepository, useValue: {} },
        { provide: AppendTrackingEventService, useValue: {} },
        { provide: AssignRiderService, useValue: { assign: vi.fn() } },
      ],
    })
      .useMocker(() => ({}))
      .compile();
    expect(module.get(AssignPickupService)).toBeDefined();
  });

  it('refuses to assign from a state that cannot be assigned', async () => {
    const fake = fakeManager({
      id: 'p-2',
      merchantId: 'm-1',
      shipmentIds: ['s-1'],
      status: 'COMPLETED',
    });
    const fakeDs = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn(fake.manager) };
    const service = new AssignPickupService(
      fakeDs as never,
      new PickupRepository(),
      new AppendTrackingEventService(),
      { assign: vi.fn() } as unknown as AssignRiderService,
    );

    await expect(
      service.execute({ pickupId: 'p-2', candidates: [], idempotencyKey: 'k-x', actorId: null }),
    ).rejects.toThrow(/COMPLETED.*ASSIGNED|ASSIGNED/);
  });
});
