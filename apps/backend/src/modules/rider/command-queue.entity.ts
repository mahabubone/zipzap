/**
 * A rider's server-held command queue for offline mode (Phase 5 rung 4).
 *
 * Delivery or rejection is derived from the two append-only markers: a row with neither set
 * is PENDING, acknowledged_at set is DELIVERED, rejected_at set is REJECTED. Commands never
 * change their markers — a rejection is a new row's rejection_at, not a rewrite.
 */

import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export const QUEUE_STATUS = {
  PENDING: 'PENDING',
  DELIVERED: 'DELIVERED',
  REJECTED: 'REJECTED',
} as const;

export type QueueStatus = (typeof QUEUE_STATUS)[keyof typeof QUEUE_STATUS];

@Entity('command_queue', { schema: 'rider' })
export class CommandQueueEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @PrimaryColumn('uuid')
  riderId!: string;

  @Column('bigint')
  deviceSequence!: number;

  @Column('text')
  commandType!: string;

  @Column('jsonb', { nullable: true })
  payload!: object | null;

  @Column('jsonb', { nullable: true })
  expectedState!: object | null;

  @Column('timestamptz', { nullable: true })
  acknowledgedAt!: Date | null;

  @Column('timestamptz', { nullable: true })
  rejectedAt!: Date | null;

  @Column('text', { nullable: true })
  rejectionReason!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  /** Derived delivery/rejection — the append-only markers. */
  get status(): QueueStatus {
    if (this.acknowledgedAt) return QUEUE_STATUS.DELIVERED;
    if (this.rejectedAt) return QUEUE_STATUS.REJECTED;
    return QUEUE_STATUS.PENDING;
  }
}
