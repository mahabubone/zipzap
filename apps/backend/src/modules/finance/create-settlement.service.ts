/**
 * CreateSettlement — freezes the unsettled entries into a contract.
 *
 * The freeze reads unsettled COD_COLLECTED entries inside the same transaction that inserts the
 * settlement row. Reading outside the transaction would let a late entry sneak between the read
 * and the write — the freeze would name entries it does not contain, and the next freeze would
 * pick them up again. Double settlement of the same collection is the failure the same-
 * transaction read exists to prevent.
 *
 * The net is computed by rules/finance.ts netPayable and stored on the row. That stored copy is
 * not a derived counter — it is a checksum: re-summing the frozen snapshot must reproduce it,
 * or either the freeze or the sum has a bug, loudly.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { FinanceRepository } from './finance.repository.ts';
import { netPayable, type SettlementStatus } from './rules/finance.ts';

export interface CreateSettlementCommand {
  readonly merchantId: string;
  readonly actorId: string | null;
}

export interface CreatedSettlement {
  readonly id: string;
  readonly reference: string;
  readonly merchantId: string;
  readonly status: SettlementStatus;
  readonly items: ReadonlyArray<{
    entryId: string;
    type: string;
    direction: 1 | -1;
    amountMinor: number;
  }>;
  readonly netMinor: number;
  readonly currency: string;
}

@Injectable()
export class CreateSettlementService {
  constructor(
    @InjectDataSource('finance') private readonly financeDataSource: DataSource,
    @Inject(FinanceRepository) private readonly finance: FinanceRepository,
  ) {}

  async execute(command: CreateSettlementCommand): Promise<CreatedSettlement> {
    return this.financeDataSource.transaction(async (manager) => {
      const entries = await this.finance.findUnsettledCodEntries(manager, command.merchantId);
      if (entries.length === 0) {
        throw new ResourceNotFoundError('No unsettled COD collections for this merchant.');
      }

      const currency = entries[0]!.currency;
      const items = entries.map((entry) => ({
        entryId: entry.id,
        type: entry.entryType,
        direction: entry.direction as 1 | -1,
        amountMinor: Number(entry.amountMinor),
      }));
      const net = netPayable(items);

      const now = new Date();
      const reference = `SET-${now.getUTCFullYear()}-${String(Date.now()).slice(-6)}`;
      const saved = await this.finance.insertSettlement(manager, {
        id: randomUUID(),
        reference,
        merchantId: command.merchantId,
        status: 'CREATED',
        itemsJson: items,
        frozenNetMinor: net.amountMinor,
        currency,
        approvedBy: null,
        approvedAt: null,
        createdAt: now,
        updatedAt: now,
      } as never);

      return {
        id: saved.id,
        reference: saved.reference,
        merchantId: saved.merchantId,
        status: saved.status as SettlementStatus,
        items,
        netMinor: Number(saved.frozenNetMinor),
        currency: saved.currency,
      };
    });
  }
}
