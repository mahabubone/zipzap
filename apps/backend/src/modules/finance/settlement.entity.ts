/**
 * Settlement persistence. Owns schema `finance` only.
 *
 * A settlement is a frozen view of ledger entries, not a recalculation. `itemsJson` is the
 * snapshot taken at creation: entry ids, types, directions and amounts, summed once by
 * rules/finance.ts netPayable. After APPROVED the row is a contract — late money lands in the
 * next settlement, never here.
 *
 * `frozen_net_minor` is a stored copy of the sum, not a derived counter. It exists so the
 * freeze can be re-verified (re-sum the snapshot, compare) without re-scanning the ledger.
 * If the two ever disagree, the snapshot wins and the discrepancy is a bug, loudly.
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { SETTLEMENT_STATUSES, type SettlementStatus } from './rules/finance.ts';

@Entity('settlements')
@Index('settlements_merchant_created_idx', ['merchantId', 'createdAt'])
@Index('settlements_status_created_idx', ['status', 'createdAt'])
export class SettlementEntity {
  @PrimaryColumn('uuid')
  id!: string;

  /** Human reference, e.g. SET-2026-00041. Unique per merchant. */
  @Column('text')
  reference!: string;

  /** An identifier, not a foreign key. See ADR-0002. */
  @Column('uuid')
  merchantId!: string;

  @Column({ type: 'enum', enum: SETTLEMENT_STATUSES })
  status!: SettlementStatus;

  /** Frozen at creation: [{ entryId, type, direction, amountMinor }]. */
  @Column('jsonb')
  itemsJson!: Array<{
    entryId: string;
    type: string;
    direction: 1 | -1;
    amountMinor: number;
  }>;

  @Column('bigint')
  frozenNetMinor!: number;

  @Column('char', { length: 3 })
  currency!: string;

  @Column('uuid', { nullable: true })
  approvedBy!: string | null;

  @Column('timestamptz', { nullable: true })
  approvedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
