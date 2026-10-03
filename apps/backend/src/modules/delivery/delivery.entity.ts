/**
 * Delivery job persistence. Owns schema `delivery` only.
 *
 * Holds identifiers it must not read: `shipmentId` and `riderId` are bare references,
 * resolved through those modules' contracts. See ADR-0002.
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { DELIVERY_STATUSES, FAILURE_REASONS, type DeliveryStatus } from './rules/delivery.ts';

@Entity('jobs')
@Index('jobs_shipment_idx', ['shipmentId'], { unique: true })
@Index('jobs_rider_status_idx', ['riderId', 'status'])
export class DeliveryJobEntity {
  @PrimaryColumn('uuid')
  id!: string;

  /** Bare identifier. Not a foreign key. */
  @Column('uuid')
  shipmentId!: string;

  /** Bare identifier. Not a foreign key. */
  @Column('uuid')
  riderId!: string;

  @Column({ type: 'enum', enum: DELIVERY_STATUSES })
  status!: DeliveryStatus;

  @Column('integer')
  attemptsMade!: number;

  @Column({ type: 'enum', enum: FAILURE_REASONS, nullable: true })
  lastFailureReason!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
