/**
 * Shipment persistence. Owns schema `shipment` only.
 *
 * Entities exist here, never in domain/. They are TypeORM row shapes, not business objects —
 * the aggregate in domain/shipment.ts is the authority on state.
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { SHIPMENT_STATUSES, type ShipmentStatus } from './rules/state-machine.ts';

@Entity('shipments')
@Index('shipments_merchant_created_idx', ['merchantId', 'createdAt'])
@Index('shipments_status_created_idx', ['status', 'createdAt'])
export class ShipmentEntity {
  @PrimaryColumn('uuid')
  id!: string;

  /** Unique, and non-guessable: see generateTrackingCode. */
  @Index('shipments_tracking_code_idx', { unique: true })
  @Column('text')
  trackingCode!: string;

  /** The merchant's own invoice reference. The bulk dedupe anchor; null for single creates. */
  @Column('text', { nullable: true })
  merchantReference!: string | null;

  /** An identifier, not a foreign key. See ADR-0002. */
  @Column('uuid')
  merchantId!: string;

  @Column('text')
  senderName!: string;

  @Column('text')
  senderPhone!: string;

  @Column('text')
  senderAddress!: string;

  @Column('text')
  recipientName!: string;

  @Column('text')
  recipientPhone!: string;

  @Column('text')
  recipientAddress!: string;

  @Column('integer')
  parcelWeightGrams!: number;

  @Column('text')
  parcelDescription!: string;

  /** Money: integer minor units + currency. Never a float. ADR-0009. */
  @Column('bigint')
  codAmountMinor!: number;

  @Column('char', { length: 3 })
  codCurrency!: string;

  @Column({ type: 'enum', enum: SHIPMENT_STATUSES })
  status!: ShipmentStatus;

  /** The state ON_HOLD interrupted, so release resumes exactly. */
  @Column({ type: 'enum', enum: SHIPMENT_STATUSES, nullable: true })
  heldFromStatus!: ShipmentStatus | null;

  /** Frozen at creation: a later price change must not rewrite what was charged. */
  @Column('integer')
  pricingVersion!: number;

  /** The zone this parcel was priced and serviceability-checked against. Not a
   *  foreign key to network.service_areas: the zone list is another module's data
   *  and grows, and a parcel must keep naming the zone it was charged for even
   *  if that zone is later retired. NULL on rows created before it was stored. */
  @Column('text', { nullable: true })
  zone!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
