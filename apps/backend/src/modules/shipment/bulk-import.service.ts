/**
 * Bulk import: upload → preview (human checkpoint) → accept → chunked process.
 *
 * A bulk job never performs thousands of synchronous inserts inside one HTTP
 * request. Upload stores the parsed preview rows; accept enqueues one BullMQ
 * job per 100-row chunk; each chunk runs in its own transaction. One 10,000-row
 * transaction would hold locks on 10,000 rows and block the merchant's own
 * dashboard — chunking bounds transaction duration and lock hold time.
 *
 * Idempotency is on merchant invoice reference: a row whose invoice already
 * exists for this merchant is SKIPPED_DUPLICATE, never a second parcel. The
 * preview is the checkpoint — the first upload always has a column-mapping
 * mistake, and 10,000 mis-mapped shipments is a support incident.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type { Queue } from 'bullmq';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { BulkRepository } from './bulk.repository.ts';
import {
  BULK_COLUMNS,
  chunkRows,
  mapHeader,
  parseCsv,
  validateRow,
  type BulkJobStatus,
} from './rules/bulk.ts';

export const BULK_QUEUE = 'bulk-import';

export interface BulkJobView {
  readonly id: string;
  readonly merchantId: string;
  readonly filename: string;
  readonly status: BulkJobStatus;
  readonly totalRows: number;
  readonly processedRows: number;
  readonly succeededRows: number;
  readonly failedRows: number;
  readonly skippedRows: number;
}

export interface BulkPreview {
  readonly job: BulkJobView;
  readonly rows: Array<{
    lineNumber: number;
    invoice: string;
    outcome: string;
    reason: string | null;
  }>;
}

function toView(entity: {
  id: string;
  merchantId: string;
  filename: string;
  status: BulkJobStatus;
  totalRows: number;
  processedRows: number;
  succeededRows: number;
  failedRows: number;
  skippedRows: number;
}): BulkJobView {
  return { ...entity };
}

@Injectable()
export class BulkImportService {
  constructor(
    @InjectDataSource('shipment') private readonly shipments: DataSource,
    @Inject(BulkRepository) private readonly bulk: BulkRepository,
    @InjectQueue(BULK_QUEUE) private readonly queue: Queue,
  ) {}

  /** Upload: parse, validate, store preview rows, return the checkpoint. */
  async upload(merchantId: string, filename: string, text: string): Promise<BulkPreview> {
    const parsed = parseCsv(text);
    if (parsed.length === 0) {
      throw new ResourceNotFoundError('Empty file.');
    }
    const { index, missing } = mapHeader(parsed[0]!);
    if (missing.length > 0) {
      throw new ResourceNotFoundError(`Missing required columns: ${missing.join(', ')}.`);
    }

    const jobId = randomUUID();
    const now = new Date();
    const rows = parsed.slice(1).map((cells, i) => {
      const fields: Record<string, string> = {};
      for (const column of BULK_COLUMNS) {
        const position = index[column];
        fields[column] = position !== undefined ? (cells[position] ?? '') : '';
      }
      return {
        lineNumber: i + 2,
        invoice: (fields.invoice ?? '').trim(),
        fields,
        outcome: validateRow(fields),
      };
    });

    await this.shipments.transaction(async (manager) => {
      await this.bulk.insertJob(manager, {
        id: jobId,
        merchantId,
        filename,
        status: 'PREVIEW',
        totalRows: rows.length,
        processedRows: 0,
        succeededRows: 0,
        failedRows: 0,
        skippedRows: 0,
        createdAt: now,
        updatedAt: now,
      } as never);
      await this.bulk.insertRows(
        manager,
        rows.map(
          (row) =>
            ({
              id: randomUUID(),
              jobId,
              lineNumber: row.lineNumber,
              invoice: row.invoice,
              fields: row.fields,
              outcome: row.outcome.kind,
              reason: row.outcome.kind === 'READY' ? null : row.outcome.reason,
              shipmentId: null,
              createdAt: now,
            }) as never,
        ),
      );
    });

    // PENDING -> VALIDATING -> PREVIEW collapses: parsing IS validation here,
    // and the stored rows ARE the preview. The trigger still guards the chain.
    const job = await this.shipments.transaction(async (manager) => {
      const found = await this.bulk.findJobForUpdate(manager, jobId);
      if (!found) throw new ResourceNotFoundError('Bulk job not found.');
      found.status = 'VALIDATING';
      await this.bulk.saveJob(manager, found);
      found.status = 'PREVIEW';
      return this.bulk.saveJob(manager, found);
    });

    const stored = await this.shipments.transaction((manager) =>
      this.bulk.findRows(manager, jobId),
    );
    return {
      job: toView(job),
      rows: stored.map((r) => ({
        lineNumber: r.lineNumber,
        invoice: r.invoice,
        outcome: r.outcome,
        reason: r.reason,
      })),
    };
  }

  /** Accept: move PREVIEW -> PROCESSING and enqueue one job per 100-row chunk. */
  async accept(merchantId: string, jobId: string): Promise<BulkJobView> {
    const job = await this.shipments.transaction(async (manager) => {
      const found = await this.bulk.findJobForUpdate(manager, jobId);
      if (!found || found.merchantId !== merchantId) {
        throw new ResourceNotFoundError('Bulk job not found.');
      }
      if (found.status !== 'PREVIEW') {
        throw new ResourceNotFoundError('Only a previewed job can be accepted.');
      }
      found.status = 'PROCESSING';
      return this.bulk.saveJob(manager, found);
    });

    const rows = await this.shipments.transaction((manager) => this.bulk.findRows(manager, jobId));
    const chunks = chunkRows(rows, 100);
    for (let index = 0; index < chunks.length; index++) {
      await this.queue.add(
        'process-chunk',
        { jobId, chunkIndex: index, rowIds: chunks[index]!.map((r) => r.id) },
        { jobId: `${jobId}-chunk-${index}` },
      );
    }
    return toView(job);
  }

  async progress(merchantId: string, jobId: string): Promise<BulkJobView> {
    const job = await this.shipments.transaction((manager) => this.bulk.findJob(manager, jobId));
    if (!job || job.merchantId !== merchantId) {
      throw new ResourceNotFoundError('Bulk job not found.');
    }
    return toView(job);
  }

  /** Downloadable result: every row and its outcome. CSV out, universally parseable. */
  async resultCsv(merchantId: string, jobId: string): Promise<string> {
    const job = await this.shipments.transaction((manager) => this.bulk.findJob(manager, jobId));
    if (!job || job.merchantId !== merchantId) {
      throw new ResourceNotFoundError('Bulk job not found.');
    }
    const rows = await this.shipments.transaction((manager) => this.bulk.findRows(manager, jobId));
    const lines = ['line_number,invoice,outcome,reason,shipment_id'];
    for (const row of rows) {
      lines.push(
        [
          row.lineNumber,
          csvCell(row.invoice),
          row.outcome,
          csvCell(row.reason ?? ''),
          row.shipmentId ?? '',
        ].join(','),
      );
    }
    return lines.join('\n') + '\n';
  }
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export { mapHeader, parseCsv, validateRow };
