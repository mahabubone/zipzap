/**
 * Ledger entry persistence. Owns schema `finance` only — and `finance` owns all money movement.
 *
 * One row per movement, never updated or deleted (the trigger below enforces this at the
 * database, since REVOKE from the table owner is a no-op in PostgreSQL).
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import { LEDGER_ENTRY_TYPES, type LedgerEntryType } from './rules/finance.ts';

@Entity('ledger_entries')
@Index('ledger_entries_merchant_recorded_idx', ['merchantId', 'recordedAt'])
@Index('ledger_entries_reference_idx', ['referenceType', 'referenceId'])
export class LedgerEntryEntity {
  @PrimaryColumn('uuid')
  id!: string;

  /** An identifier, not a foreign key. See ADR-0002. */
  @Column('uuid')
  merchantId!: string;

  @Column({ type: 'enum', enum: LEDGER_ENTRY_TYPES })
  entryType!: LedgerEntryType;

  /** +1 credits the merchant, -1 debits. Never derived from a value that could be zero. */
  @Column('smallint')
  direction!: 1 | -1;

  /** Integer minor units. Never a float. ADR-0009. */
  @Column('bigint')
  amountMinor!: number;

  @Column('char', { length: 3 })
  currency!: string;

  /** SHIPMENT | COD_RECORD | SETTLEMENT | ADJUSTMENT — an entry nobody can trace is unauditable. */
  @Column('text')
  referenceType!: string;

  @Column('uuid')
  referenceId!: string;

  @Column('text', { nullable: true })
  memo!: string | null;

  /** When the money moved in the real world. */
  @Column('timestamptz')
  occurredAt!: Date;

  /** When we recorded it. Differs from occurred_at whenever reconciliation lags collection. */
  @CreateDateColumn()
  recordedAt!: Date;
}
