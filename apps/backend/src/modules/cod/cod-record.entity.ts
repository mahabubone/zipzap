/**
 * COD record persistence. Owns schema `cod` only.
 *
 * One row per shipment that carries COD. `expectedMinor` is the promise from the frozen quote —
 * it is never overwritten by collection, because the gap between promise and reality is exactly
 * what reconciliation measures. `collectedMinor` is what the rider actually handed back.
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { COD_STATUSES, type CodStatus } from './rules/cod.ts';

@Entity('records')
@Index('records_merchant_created_idx', ['merchantId', 'createdAt'])
@Index('records_status_created_idx', ['status', 'createdAt'])
export class CodRecordEntity {
  @PrimaryColumn('uuid')
  id!: string;

  /** An identifier, not a foreign key. See ADR-0002. */
  @Index('records_shipment_idx', { unique: true })
  @Column('uuid')
  shipmentId!: string;

  /** An identifier, not a foreign key. See ADR-0002. */
  @Column('uuid')
  merchantId!: string;

  /** Money: integer minor units + currency. Never a float. ADR-0009. */
  @Column('bigint')
  expectedMinor!: number;

  @Column('bigint', { nullable: true })
  collectedMinor!: number | null;

  @Column('char', { length: 3 })
  currency!: string;

  @Column({ type: 'enum', enum: COD_STATUSES })
  status!: CodStatus;

  @Column('text', { nullable: true })
  failureNote!: string | null;

  /**
   * What the reviewer concluded, and who concluded it.
   *
   * Separate from `failureNote` because they are different facts: the failure describes the
   * problem, the review describes the decision about it. One nullable text column cannot hold both
   * without the second write overwriting the first.
   *
   * Nullable and left NULL by collection. A record that was never reviewed has no review note, and
   * inventing one would put a reviewer's name on a decision nobody made.
   */
  @Column('text', { nullable: true })
  reviewNote!: string | null;

  /** An actor id, not a foreign key to identity.users. See ADR-0002. */
  @Column('uuid', { nullable: true })
  reviewedBy!: string | null;

  @Column('timestamptz', { nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
