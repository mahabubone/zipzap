/**
 * Pickup request persistence. Owns schema `pickup` only.
 *
 * A pickup is identified by its own id — it holds shipment ids as bare identifiers, never as
 * foreign keys. See ADR-0002.
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { PICKUP_STATUSES, type PickupStatus } from './rules/pickup.ts';

@Entity('pickups')
@Index('pickups_merchant_created_idx', ['merchantId', 'createdAt'])
@Index('pickups_status_created_idx', ['status', 'createdAt'])
export class PickupEntity {
  @PrimaryColumn('uuid')
  id!: string;

  /** An identifier, not a foreign key. See ADR-0002. */
  @Column('uuid')
  merchantId!: string;

  /** Member shipments as identifiers, not FKs. The batch owns its membership. */
  @Column('uuid', { array: true })
  shipmentIds!: string[];

  /** An identifier for the rider assignment, resolved through the rider contract. */
  @Column('uuid', { nullable: true })
  riderId!: string | null;

  @Column({ type: 'enum', enum: PICKUP_STATUSES })
  status!: PickupStatus;

  /** The state a FAILED pickup may be rescheduled from; null once terminal. */
  @Column('text', { nullable: true })
  failureReason!: string | null;

  @Column('integer')
  totalWeightGrams!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
