/**
 * Return request persistence. Owns schema `returns` only.
 *
 * One row per return. `shipmentId` references the ORIGINAL shipment — never a
 * second, unrelated parcel. Two disconnected records for one physical parcel is
 * how inventory and money drift apart.
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import {
  RETURN_REASONS,
  RETURN_STATUSES,
  type ReturnReason,
  type ReturnStatus,
} from './rules/returns.ts';

@Entity('requests')
export class ReturnRequestEntity {
  @PrimaryColumn('uuid')
  id!: string;

  /** The original shipment. An identifier, not a foreign key. See ADR-0002. */
  @Index('requests_shipment_idx', { unique: true })
  @Column('uuid')
  shipmentId!: string;

  /** An identifier, not a foreign key. */
  @Column('uuid')
  merchantId!: string;

  @Column({ type: 'enum', enum: RETURN_REASONS })
  reason!: ReturnReason;

  @Column({ type: 'enum', enum: RETURN_STATUSES })
  status!: ReturnStatus;

  @Column('text', { nullable: true })
  reviewNote!: string | null;

  @Column('uuid', { nullable: true })
  decidedBy!: string | null;

  @Column('timestamptz', { nullable: true })
  decidedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
