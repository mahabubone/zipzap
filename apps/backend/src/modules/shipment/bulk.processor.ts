/**
 * Bulk chunk processor: one job, one 100-row chunk, one transaction per row-group.
 *
 * Each READY row creates a shipment through CreateShipmentService with the
 * invoice as merchantReference and a bulk-scoped idempotency key. Rows whose
 * invoice already exists are SKIPPED_DUPLICATE — recorded, not created. FAILED
 * rows from preview are skipped without touching the database beyond the row
 * update: the preview already said no.
 *
 * Partial failure is normal: the job aggregates to COMPLETED_WITH_ERRORS, which
 * is a success state with a result file, not a failure state.
 */

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Job } from 'bullmq';
import type { DataSource } from 'typeorm';
import { BULK_QUEUE } from './bulk-import.service.ts';
import { BulkRepository } from './bulk.repository.ts';
import { CreateShipmentService } from './create-shipment.service.ts';
import { money } from '../../common/money.ts';

interface ChunkJob {
  readonly jobId: string;
  readonly chunkIndex: number;
  readonly rowIds: string[];
}

@Processor(BULK_QUEUE)
export class BulkProcessor extends WorkerHost {
  constructor(
    @InjectDataSource('shipment') private readonly shipments: DataSource,
    @Inject(BulkRepository) private readonly bulk: BulkRepository,
    @Inject(CreateShipmentService) private readonly createShipment: CreateShipmentService,
  ) {
    super();
  }

  async process(job: Job<ChunkJob>): Promise<void> {
    const { jobId, rowIds } = job.data;

    const context = await this.shipments.transaction(async (manager) => {
      const bulkJob = await this.bulk.findJob(manager, jobId);
      if (!bulkJob) return null;
      return { merchantId: bulkJob.merchantId };
    });
    if (!context) return;

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const rowId of rowIds) {
      const outcome = await this.processRow(jobId, rowId, context.merchantId);
      if (outcome === 'succeeded') succeeded += 1;
      else if (outcome === 'skipped') skipped += 1;
      else failed += 1;
    }

    await this.shipments.transaction(async (manager) => {
      const bulkJob = await this.bulk.findJobForUpdate(manager, jobId);
      if (!bulkJob) return;
      bulkJob.processedRows += rowIds.length;
      bulkJob.succeededRows += succeeded;
      bulkJob.failedRows += failed;
      bulkJob.skippedRows += skipped;
      if (bulkJob.processedRows >= bulkJob.totalRows) {
        bulkJob.status =
          bulkJob.failedRows > 0 || bulkJob.skippedRows > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
      }
      await this.bulk.saveJob(manager, bulkJob);
    });
  }

  private async processRow(
    jobId: string,
    rowId: string,
    merchantId: string,
  ): Promise<'succeeded' | 'failed' | 'skipped'> {
    return this.shipments.transaction(async (manager) => {
      const rows = await this.bulk.findRows(manager, jobId);
      const row = rows.find((r) => r.id === rowId);
      if (!row || row.outcome !== 'READY') return 'failed';

      // Dedupe on merchant invoice: re-uploads skip, never double.
      const existing = await manager
        .getRepository('shipments' as never)
        .findOneBy({ merchantId, merchantReference: row.invoice } as never)
        .catch(() => null);
      if (existing) {
        row.outcome = 'SKIPPED_DUPLICATE';
        row.reason = 'shipment already exists';
        await this.bulk.saveRow(manager, row);
        return 'skipped';
      }

      const fields = row.fields as Record<string, string>;
      const weight = Number(fields.parcel_weight ?? '') || 1000;
      const codRaw = (fields.cod_amount ?? '').trim();
      const codMinor = codRaw ? Number.parseInt(codRaw, 10) : 0;

      try {
        const { result } = await this.createShipment.execute({
          merchantId,
          merchantPlan: 'standard',
          zone: (fields.destination_area ?? '').trim() || 'dhaka-metro',
          remoteArea: false,
          fragile: false,
          packagingKind: null,
          sender: { name: 'Bulk', phone: '+8801700000000', line: 'Bulk upload' },
          recipient: {
            name: (fields.recipient_name ?? '').trim() || 'Bulk',
            phone: (fields.recipient_phone ?? '').trim(),
            line: (fields.recipient_address ?? '').trim(),
          },
          parcel: {
            weightGrams: weight,
            description: (fields.item_description ?? '').trim() || 'Bulk upload',
          },
          cod: money(codMinor),
          merchantReference: row.invoice,
          idempotencyKey: `bulk:${jobId}:${row.invoice}`,
          actorId: null,
        });
        row.outcome = 'CREATED';
        row.shipmentId = result.id;
        await this.bulk.saveRow(manager, row);
        return 'succeeded';
      } catch (error) {
        row.outcome = 'FAILED';
        row.reason =
          error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
        await this.bulk.saveRow(manager, row);
        return 'failed';
      }
    });
  }

  @OnWorkerEvent('failed')
  onFailed(): void {
    // Chunk failures are recorded per row, not by BullMQ: a processor throw
    // must be loud, not silently absorbed.
  }
}
