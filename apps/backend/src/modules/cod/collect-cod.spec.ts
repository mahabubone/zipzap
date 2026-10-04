import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { CollectCodService } from './collect-cod.service.ts';
import { CodRecordRepository } from './cod-record.repository.ts';
import { CodRecordNotFoundError } from '../../common/domain-error.ts';

/**
 * The collect choreography, minus the database.
 *
 * What these cover: the lock-before-read, the four-writes-one-transaction orchestration, and
 * that partial collection settles at the collected amount rather than inventing the shortfall.
 * Real atomicity — the concurrent-collect race — is proven by test/integration/ against
 * Postgres, where the row lock actually serialises.
 */

const COMMAND = {
  shipmentId: 's-collect-1',
  collectedMinor: 125_050,
  idempotencyKey: 'key-collect-1',
  actorId: null as string | null,
};

function fakeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cod-1',
    shipmentId: 's-collect-1',
    merchantId: 'm-1',
    expectedMinor: 125_050,
    collectedMinor: null,
    currency: 'BDT',
    status: 'COD_EXPECTED',
    failureNote: null,
    ...overrides,
  };
}

/** In-memory stand-in for the transaction manager. Records every SQL table touched, in order. */
function fakeManager(record: Record<string, unknown> | null = null) {
  const touched: string[] = [];
  return {
    touched,
    manager: {
      query: (sql: string) => {
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
          touched.push('cod.records');
          return Promise.resolve(entity);
        },
        findOneBy: () => Promise.resolve(record),
      }),
      createQueryBuilder: () => ({
        setLock: () => ({
          where: () => ({
            getOne: () => {
              touched.push('lock:cod.records');
              return Promise.resolve(record);
            },
          }),
        }),
      }),
    },
  };
}

function serviceWith(fake: ReturnType<typeof fakeManager>): CollectCodService {
  const fakeDs = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn(fake.manager) };
  return new CollectCodService(
    fakeDs as never,
    new CodRecordRepository(),
    new AppendTrackingEventService(),
  );
}

describe('CollectCodService orchestration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('locks the record, collects the full amount, and writes all four rows', async () => {
    const fake = fakeManager(fakeRecord());
    const service = serviceWith(fake);

    const { result, replayed } = await service.execute({ ...COMMAND });

    expect(replayed).toBe(false);
    expect(result.status).toBe('COD_COLLECTED');
    expect(result.shortfallMinor).toBe(0);
    expect(fake.touched).toEqual([
      'claim:system.idempotency_keys',
      'lock:cod.records',
      'cod.records',
      'tracking.events',
      'system.outbox_events',
      'complete:system.idempotency_keys',
    ]);
  });

  it('records a short collection as PARTIAL with the shortfall visible', async () => {
    const fake = fakeManager(fakeRecord());
    const service = serviceWith(fake);

    const { result } = await service.execute({
      ...COMMAND,
      collectedMinor: 125_000,
      idempotencyKey: 'key-partial',
    });

    expect(result.status).toBe('PARTIAL_COLLECTION');
    expect(result.shortfallMinor).toBe(50);
    expect(result.collectedMinor).toBe(125_000);
  });

  it('404s when no record exists — never-existed is not collected-nothing', async () => {
    const fake = fakeManager(null);
    const service = serviceWith(fake);

    await expect(service.execute({ ...COMMAND, idempotencyKey: 'key-missing' })).rejects.toThrow(
      CodRecordNotFoundError,
    );
  });

  it('resolves through the real Nest container with mocked boundaries', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectCodService,
        { provide: CodRecordRepository, useValue: {} },
        { provide: AppendTrackingEventService, useValue: { append: vi.fn() } },
      ],
    })
      .useMocker(() => ({}))
      .compile();

    expect(module.get(CollectCodService)).toBeDefined();
  });
});
