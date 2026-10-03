import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RecordAttemptService } from './record-attempt.service.ts';
import { DeliveryRepository } from './delivery.repository.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';

/**
 * The attempt transaction, minus the databases.
 *
 * What this proves: the reason drives the branch — retryable with budget left goes back OUT,
 * anything else ends the job. Atomicity itself is proven by test/integration/.
 */

function fakeManager(job: Record<string, unknown>) {
  const written: string[] = [];
  return {
    written,
    manager: {
      createQueryBuilder: () => ({
        setLock: () => ({
          where: () => ({ getOne: () => Promise.resolve(job) }),
        }),
      }),
      query: (sql: string) => {
        if (sql.includes('FOR UPDATE')) written.push('lock:delivery.jobs');
        else if (sql.includes('idempotency_keys')) written.push('claim:system.idempotency_keys');
        else written.push(sql.slice(0, 40));
        if (sql.includes('idempotency_keys') && sql.includes('ON CONFLICT')) {
          return Promise.resolve([{ scope: 'x' }]);
        }
        return Promise.resolve([]);
      },
      getRepository: () => ({
        findOneBy: () => Promise.resolve(null),
        save: (entity: unknown) => {
          written.push('save');
          return Promise.resolve(entity);
        },
      }),
    },
  };
}

const BASE = { idempotencyKey: 'k-a1', actorId: null as string | null };

describe('RecordAttemptService orchestration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('routes a retryable reason with budget left back OUT_FOR_DELIVERY', async () => {
    const fake = fakeManager({
      id: 'j-1',
      shipmentId: 's-1',
      status: 'OUT_FOR_DELIVERY',
      attemptsMade: 0,
    });
    const fakeDs = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn(fake.manager) };
    const service = new RecordAttemptService(
      fakeDs as never,
      new DeliveryRepository(),
      new AppendTrackingEventService(),
    );

    const { result } = await service.execute({
      ...BASE,
      jobId: 'j-1',
      reason: 'CUSTOMER_UNAVAILABLE',
    });
    expect(result.sequence).toBe(1);
    expect(result.status).toBe('OUT_FOR_DELIVERY');
    expect(result.retryScheduled).toBe(true);
  });

  it('ends the job on a terminal reason even with budget left', async () => {
    const fake = fakeManager({
      id: 'j-2',
      shipmentId: 's-2',
      status: 'OUT_FOR_DELIVERY',
      attemptsMade: 0,
    });
    const fakeDs = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn(fake.manager) };
    const service = new RecordAttemptService(
      fakeDs as never,
      new DeliveryRepository(),
      new AppendTrackingEventService(),
    );

    const { result } = await service.execute({ ...BASE, jobId: 'j-2', reason: 'WRONG_ADDRESS' });
    expect(result.status).toBe('FAILED');
    expect(result.retryScheduled).toBe(false);
  });

  it('ends the job when attempts are exhausted even for a retryable reason', async () => {
    const fake = fakeManager({
      id: 'j-3',
      shipmentId: 's-3',
      status: 'OUT_FOR_DELIVERY',
      attemptsMade: 2,
    });
    const fakeDs = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn(fake.manager) };
    const service = new RecordAttemptService(
      fakeDs as never,
      new DeliveryRepository(),
      new AppendTrackingEventService(),
    );

    const { result } = await service.execute({
      ...BASE,
      jobId: 'j-3',
      reason: 'CUSTOMER_UNAVAILABLE',
    });
    expect(result.sequence).toBe(3);
    expect(result.status).toBe('FAILED');
    expect(result.retryScheduled).toBe(false);
  });

  it('resolves through the real Nest container', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordAttemptService,
        { provide: DeliveryRepository, useValue: {} },
        { provide: AppendTrackingEventService, useValue: { append: vi.fn() } },
      ],
    })
      .useMocker(() => ({}))
      .compile();
    expect(module.get(RecordAttemptService)).toBeDefined();
  });
});
