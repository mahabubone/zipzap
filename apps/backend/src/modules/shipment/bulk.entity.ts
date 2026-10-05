/**
 * Bulk import persistence. Own schema `shipment` — this is a shipment intake
 * surface, not a new domain.
 *
 * Jobs are the merchant-visible unit; rows are the per-row outcomes. The raw
 * file is NOT stored: preview rows + result download are the record.
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { BULK_JOB_STATUSES, type BulkJobStatus } from './rules/bulk.ts';

@Entity('bulk_jobs')
export class BulkJobEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Index('bulk_jobs_merchant_created_idx')
  @Column('uuid')
  merchantId!: string;

  @Column('text')
  filename!: string;

  @Column({ type: 'enum', enum: BULK_JOB_STATUSES })
  status!: BulkJobStatus;

  @Column('integer')
  totalRows!: number;

  @Column('integer')
  processedRows!: number;

  @Column('integer')
  succeededRows!: number;

  @Column('integer')
  failedRows!: number;

  @Column('integer')
  skippedRows!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('bulk_rows')
@Index('bulk_rows_job_idx', ['jobId', 'lineNumber'])
@Index('bulk_rows_job_invoice_idx', ['jobId', 'invoice'], { unique: true })
export class BulkRowEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  jobId!: string;

  @Column('integer')
  lineNumber!: number;

  @Column('text')
  invoice!: string;

  /** The parsed row fields. Shipment creation reads these at process time. */
  @Column('jsonb')
  fields!: Record<string, string>;

  /** READY | FAILED | SKIPPED_DUPLICATE — the row-level outcome. */
  @Column('text')
  outcome!: string;

  @Column('text', { nullable: true })
  reason!: string | null;

  @Column('uuid', { nullable: true })
  shipmentId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
