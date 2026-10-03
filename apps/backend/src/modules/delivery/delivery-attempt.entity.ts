/**
 * Every attempt is recorded — including failures and their reasons. Three failed attempts with
 * no record are indistinguishable from three successful ones.
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import { FAILURE_REASONS } from './rules/delivery.ts';

@Entity('attempts')
@Index('attempts_job_seq_idx', ['jobId', 'sequence'], { unique: true })
export class DeliveryAttemptEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  jobId!: string;

  /** Monotonic per job: attempt 1, 2, 3. */
  @Column('integer')
  sequence!: number;

  @Column({ type: 'enum', enum: FAILURE_REASONS })
  reason!: string;

  @Column('text', { nullable: true })
  note!: string | null;

  @CreateDateColumn()
  attemptedAt!: Date;
}
