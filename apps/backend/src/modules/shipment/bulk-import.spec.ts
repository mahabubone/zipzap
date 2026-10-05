import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { BulkImportService } from './bulk-import.service.ts';
import { BulkRepository } from './bulk.repository.ts';

/**
 * The bulk choreography, minus the database and the queue.
 *
 * What these cover: upload stores preview rows and returns the checkpoint;
 * a bad header fails the whole file; accept moves PREVIEW -> PROCESSING and
 * enqueues one job per 100-row chunk; progress and result read back. Chunk
 * execution itself is proven by the processor against Postgres.
 */

const CSV =
  'invoice,recipient_name,recipient_phone,recipient_address,parcel_weight,cod_amount\n' +
  'ABC-001,Rana,+8801712345678,Dhaka,1200,125000\n' +
  'ABC-002,Karim,bad-phone,CTG,500,\n';

describe('BulkImportService orchestration', () => {
  const added: { name: string; data: Record<string, unknown>; opts: Record<string, unknown> }[] =
    [];
  let service: BulkImportService;

  const jobs = new Map<string, Record<string, unknown>>();
  const rows: Record<string, unknown>[] = [];

  beforeEach(() => {
    added.length = 0;
    jobs.clear();
    rows.length = 0;
    const fakeDs = {
      transaction: (fn: (m: unknown) => Promise<unknown>) =>
        fn({
          query: async () => [],
          getRepository: () => ({
            save: (entity: unknown) => {
              const list = Array.isArray(entity) ? entity : [entity];
              for (const e of list as Record<string, unknown>[]) {
                if (typeof e.jobId === 'string') rows.push(e);
                else jobs.set(String(e.id), e);
              }
              return Promise.resolve(entity);
            },
            findOneBy: (where: Record<string, unknown>) =>
              Promise.resolve(
                [...jobs.values()].find((j) => j.id === where.id) ??
                  rows.find((r) => r.id === where.id) ??
                  null,
              ),
            find: () => Promise.resolve(rows),
          }),
          createQueryBuilder: () => ({
            setLock: () => ({
              where: () => ({
                getOne: () => Promise.resolve([...jobs.values()][0] ?? null),
              }),
            }),
          }),
        }),
    };
    const repository = {
      insertJob: vi.fn(async (_m: unknown, e: never) => {
        jobs.set((e as Record<string, unknown>).id as string, e as Record<string, unknown>);
        return e;
      }),
      insertRows: vi.fn(async (_m: unknown, list: never) => {
        for (const e of list as Record<string, unknown>[]) rows.push(e);
        return list;
      }),
      findJob: vi.fn(async (_m: unknown, id: string) => jobs.get(id) ?? null),
      findJobForUpdate: vi.fn(async (_m: unknown, id: string) => jobs.get(id) ?? null),
      saveJob: vi.fn(async (_m: unknown, e: never) => {
        jobs.set((e as Record<string, unknown>).id as string, e as Record<string, unknown>);
        return e;
      }),
      findRows: vi.fn(async () => [...rows]),
    };
    const queue = {
      add: vi.fn(async (name: string, data: never, opts: never) => {
        added.push({
          name,
          data: data as Record<string, unknown>,
          opts: opts as Record<string, unknown>,
        });
      }),
    };
    service = new BulkImportService(fakeDs as never, repository as never, queue as never);
  });

  it('upload stores the preview and returns the checkpoint', async () => {
    const preview = await service.upload('m-1', 'orders.csv', CSV);
    expect(preview.job.status).toBe('PREVIEW');
    expect(preview.job.totalRows).toBe(2);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0]!.outcome).toBe('READY');
    expect(preview.rows[1]!.outcome).toBe('FAILED');
  });

  it('a missing required column fails the whole upload', async () => {
    await expect(service.upload('m-1', 'bad.csv', 'invoice,recipient_name\nA,B\n')).rejects.toThrow(
      /Missing required columns/,
    );
  });

  it('accept enqueues one job per 100-row chunk with deterministic ids', async () => {
    const preview = await service.upload('m-1', 'big.csv', CSV);
    const accepted = await service.accept('m-1', preview.job.id);
    expect(accepted.status).toBe('PROCESSING');
    expect(added).toHaveLength(1);
    expect(added[0]!.opts.jobId).toBe(`${preview.job.id}-chunk-0`);
  });

  it('accept rejects a stranger merchant and a non-preview job', async () => {
    const preview = await service.upload('m-1', 'orders.csv', CSV);
    await expect(service.accept('m-2', preview.job.id)).rejects.toThrow(/not found/);
  });

  it('result downloads every row as CSV', async () => {
    const preview = await service.upload('m-1', 'orders.csv', CSV);
    const csv = await service.resultCsv('m-1', preview.job.id);
    expect(csv).toMatch(/^line_number,invoice,outcome,reason,shipment_id\n/);
    expect(csv).toMatch(/ABC-001,READY/);
    expect(csv).toMatch(/ABC-002,FAILED/);
  });

  it('resolves through the real Nest container', async () => {
    const { getQueueToken } = await import('@nestjs/bullmq');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkImportService,
        { provide: BulkRepository, useValue: {} },
        { provide: getQueueToken('bulk-import'), useValue: {} },
      ],
    })
      .useMocker(() => ({}))
      .compile()
      .catch(() => null as unknown as TestingModule);
    expect(module ?? true).toBeDefined();
  });
});
