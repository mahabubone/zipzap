import { describe, expect, it, vi } from 'vitest';
import { BulkProcessor } from './bulk.processor.ts';

/**
 * Chunk retry convergence, minus the database and the queue.
 *
 * A retried chunk must replay already-terminal rows as their recorded outcome,
 * not as failures: without this, a 10k import whose chunks retry (103 did live,
 * on a too-strict status trigger) reports COMPLETED_WITH_ERRORS with 0 successes
 * while all 10,000 shipments exist. Proven live 2026-10-05; this pins it.
 */

interface Row {
  id: string;
  outcome: string;
  invoice: string;
  fields: Record<string, string>;
  shipmentId: string | null;
  reason: string | null;
}

function harness(rows: Row[], existingReferences: Set<string> = new Set()) {
  const job = {
    id: 'job-1',
    merchantId: 'm-1',
    processedRows: 0,
    succeededRows: 0,
    failedRows: 0,
    skippedRows: 0,
    totalRows: rows.length,
    status: 'PROCESSING',
  };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const execute = vi.fn(async () => ({ result: { id: 's-new' }, replayed: false }));
  const fakeDs = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn({}) };
  const bulk = {
    findJob: async () => ({ merchantId: 'm-1' }),
    findJobForUpdate: async () => job,
    saveJob: async (_m: unknown, e: never) => e,
    findRowById: async (_m: unknown, id: string) => byId.get(id) ?? null,
    saveRow: async (_m: unknown, e: never) => e,
  };
  const created = {
    findByMerchantReference: async (_m: unknown, _merchant: string, reference: string) =>
      existingReferences.has(reference) ? { id: 's-existing' } : null,
  };
  const processor = new BulkProcessor(
    fakeDs as never,
    bulk as never,
    created as never,
    {
      execute,
    } as never,
  );
  return { job, execute, processor };
}

const READY: Row = {
  id: 'row-ready',
  outcome: 'READY',
  invoice: 'INV-1',
  fields: {
    recipient_name: 'Rana',
    recipient_phone: '+8801712345678',
    recipient_address: 'Dhaka',
    destination_area: 'dhaka-metro',
    cod_amount: '125000',
    parcel_weight: '1200',
    item_description: 'Shirts',
  },
  shipmentId: null,
  reason: null,
};

describe('BulkProcessor retry convergence', () => {
  it('replays CREATED rows as successes without creating again', async () => {
    const created: Row = { ...READY, id: 'row-done', outcome: 'CREATED', shipmentId: 's-1' };
    const { job, execute, processor } = harness([created]);
    await processor.process({
      data: { jobId: 'job-1', chunkIndex: 0, rowIds: ['row-done'] },
    } as never);
    expect(execute).not.toHaveBeenCalled();
    expect(job.succeededRows).toBe(1);
    expect(job.failedRows).toBe(0);
  });

  it('replays SKIPPED_DUPLICATE rows as skips', async () => {
    const skipped: Row = {
      ...READY,
      id: 'row-skip',
      outcome: 'SKIPPED_DUPLICATE',
      reason: 'shipment already exists',
    };
    const { job, execute, processor } = harness([skipped]);
    await processor.process({
      data: { jobId: 'job-1', chunkIndex: 0, rowIds: ['row-skip'] },
    } as never);
    expect(execute).not.toHaveBeenCalled();
    expect(job.skippedRows).toBe(1);
    expect(job.failedRows).toBe(0);
  });

  it('creates READY rows and skips ones whose invoice already exists', async () => {
    const fresh: Row = { ...READY, id: 'row-fresh', invoice: 'INV-NEW' };
    const dup: Row = { ...READY, id: 'row-dup', invoice: 'INV-OLD' };
    const { job, execute, processor } = harness([fresh, dup], new Set(['INV-OLD']));
    await processor.process({
      data: { jobId: 'job-1', chunkIndex: 0, rowIds: ['row-fresh', 'row-dup'] },
    } as never);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(job.succeededRows).toBe(1);
    expect(job.skippedRows).toBe(1);
    expect(job.failedRows).toBe(0);
    expect(fresh.outcome).toBe('CREATED');
    expect(dup.outcome).toBe('SKIPPED_DUPLICATE');
  });
});
