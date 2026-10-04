/**
 * PostLedgerEntry — the only way money enters the ledger.
 *
 * There is no update path, no correction path, and no delete path in this service. A correction
 * is a second call with direction flipped and a memo explaining why — the wrong row stays
 * visible, the new row explains it, and the sum is correct. The database trigger makes this
 * more than a convention; this service makes it the only convenient path.
 *
 * Every entry needs occurredAt distinct from recorded_at: a COD collected yesterday and
 * reconciled today must answer both "when did the money move" and "when did we learn".
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { FinanceRepository } from './finance.repository.ts';
import {
  validateLedgerEntry,
  type LedgerDirection,
  type LedgerEntryType,
} from './rules/finance.ts';
import type { Currency } from '../../common/money.ts';

export interface PostLedgerEntryCommand {
  readonly merchantId: string;
  readonly type: LedgerEntryType;
  readonly direction: LedgerDirection;
  readonly amountMinor: number;
  readonly currency?: Currency;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly memo?: string;
  readonly occurredAt?: Date;
}

export interface PostedLedgerEntry {
  readonly id: string;
  readonly merchantId: string;
  readonly type: LedgerEntryType;
  readonly direction: LedgerDirection;
  readonly amountMinor: number;
}

@Injectable()
export class PostLedgerEntryService {
  constructor(
    @InjectDataSource('finance') private readonly financeDataSource: DataSource,
    @Inject(FinanceRepository) private readonly finance: FinanceRepository,
  ) {}

  async execute(command: PostLedgerEntryCommand): Promise<PostedLedgerEntry> {
    validateLedgerEntry({ ...command, currency: command.currency ?? 'BDT' });

    return this.financeDataSource.transaction(async (manager) => {
      const now = new Date();
      const saved = await this.finance.insertEntry(manager, {
        id: randomUUID(),
        merchantId: command.merchantId,
        entryType: command.type,
        direction: command.direction,
        amountMinor: command.amountMinor,
        currency: command.currency ?? 'BDT',
        referenceType: command.referenceType,
        referenceId: command.referenceId,
        memo: command.memo ?? null,
        occurredAt: command.occurredAt ?? now,
        createdAt: now,
        recordedAt: now,
      } as never);

      return {
        id: saved.id,
        merchantId: saved.merchantId,
        type: saved.entryType,
        direction: saved.direction as LedgerDirection,
        amountMinor: Number(saved.amountMinor),
      };
    });
  }
}
