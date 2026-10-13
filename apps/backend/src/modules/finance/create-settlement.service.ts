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
 *
 * **A freeze is refused while the merchant has an unreviewed collection.** This is the plan's
 * strongest correctness claim and it was not true until now. The old behaviour was worse than
 * broken: a MISMATCH never reached the ledger, so the freeze simply did not see it, and the
 * merchant was paid for everything *else* while the disputed amount sat unreviewed and invisible.
 * A payout that quietly omits the problem is not a control.
 *
 * The check goes through `COD_LOOKUP`, never a join on `cod.records` — rule 2. `blocksSettlement`
 * lives in `cod/rules/cod.ts` because it is a business rule; this service only enforces it.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { ReconciliationExceptionError, ResourceNotFoundError } from '../../common/domain-error.ts';
import { COD_LOOKUP } from '../cod/cod.lookup.ts';
import { describeBlock } from '../cod/rules/cod.ts';
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

/** The slice of `CodLookup` this service uses. Narrow on purpose — see the note on the injection. */
interface SettlementBlocker {
  blocksFor(merchantId: string): Promise<Map<string, number>>;
  reviewedMismatches(merchantId: string): Promise<string[]>;
}

@Injectable()
export class CreateSettlementService {
  constructor(
    @InjectDataSource('finance') private readonly financeDataSource: DataSource,
    @Inject(FinanceRepository) private readonly finance: FinanceRepository,
    @Inject(COD_LOOKUP)
    // The token is typed by hand rather than as `CodLookup` because importing the concrete class
    // here would make finance depend on cod's implementation. The token IS the contract, and a
    // structural type says exactly as much as this interface does — one method, no more.
    private readonly cod: SettlementBlocker,
  ) {}

  async execute(command: CreateSettlementCommand): Promise<CreatedSettlement> {
    // Read the blockers BEFORE the freeze set, and outside the finance transaction on purpose: the
    // count comes from `cod`, which is another module's schema on another connection. Running it
    // first means a refusal costs nothing and leaves no half-written state to roll back.
    const blockers = await this.cod.blocksFor(command.merchantId);
    if (blockers.size > 0) {
      throw new ReconciliationExceptionError(describeBlock(blockers));
    }

    // A review unblocks this merchant the instant it commits, but the correcting ADJUSTMENT is
    // posted afterwards by the finance consumer. A freeze landing in that window would take the
    // over-collected row and not its correction, and the merchant would be paid the difference out
    // of their own pocket. Measured live, not theorised: review committed at .283, the freeze ran
    // at .324, the correction landed at .644 — and 50 poisha went missing from the contract.
    //
    // Blocking is the honest answer rather than waiting: this is an operator pressing a button, and
    // a retry is free for them but a silent underpayment is not recoverable by anyone.
    const owed = await this.cod.reviewedMismatches(command.merchantId);
    if (owed.length > 0) {
      const posted = await this.finance.adjustedRecordIds(this.financeDataSource.manager, owed);
      const uncorrected = owed.filter((id) => !posted.has(id));
      if (uncorrected.length > 0) {
        throw new ReconciliationExceptionError(
          `${uncorrected.length} reviewed collection(s) are still being corrected in the ledger. Retry in a moment.`,
        );
      }
    }

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
