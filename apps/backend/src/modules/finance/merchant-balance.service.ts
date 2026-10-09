/**
 * The headline balance: "you are owed ৳X, arriving Y".
 *
 * The plan is explicit that this is ONE derived number and not four separate figures called
 * outstanding / collected / pending / received. Four numbers invites the reader to add them up and
 * get something we never promised. So the response carries `balanceMinor` as the headline, and
 * everything else on it exists to make that one number arguable rather than merely asserted.
 *
 * Three things make it checkable, and they are the whole point:
 *
 *   - `lines`        the itemised breakdown. A bare sum is a number nobody can argue with; an
 *                    itemised one turns "that is wrong" into a specific question with an answer.
 *   - `asOf`         the exact instant it was true. A balance without one is a rumour.
 *   - `blocked`      why a payout is not happening, if it is not. See `cod/rules/cod.ts`.
 *
 * **Merchant-scoped, and that is a security property.** The old `GET /v1/merchants/:id/balance`
 * took the merchant id from the path and never checked it against the credential, so any valid key
 * could read any merchant's balance. This service takes no merchant id at all — the caller passes
 * the principal's own, and there is nothing to tamper with. The path-parameter endpoint stays for
 * ops tooling, which legitimately needs to look up an arbitrary merchant.
 *
 * Derived, never stored. A stored balance is a counter, counters drift, and a drifted money figure
 * is discovered by a merchant.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { COD_LOOKUP } from '../cod/cod.lookup.ts';
import { describeBlock } from '../cod/rules/cod.ts';
import type { Currency } from '../../common/money.ts';
import { FinanceRepository } from './finance.repository.ts';
import {
  assertLinesReconcile,
  balanceLines,
  headlineBalance,
  type BalanceLine,
  type LedgerDirection,
  type LedgerEntryType,
} from './rules/finance.ts';

export interface MerchantBalance {
  readonly merchantId: string;
  /** The one number. Signed: negative means we owe the merchant, not the reverse. */
  readonly balanceMinor: number;
  readonly currency: Currency;
  readonly asOf: string;
  readonly lines: ReadonlyArray<BalanceLine>;
  /** Non-empty when a payout is being withheld. Empty means nothing is in the way. */
  readonly blocked: ReadonlyArray<{ readonly status: string; readonly count: number }>;
  readonly blockedReason: string | null;
  /**
   * The next settlement's reference and date, when one exists.
   *
   * Derived from the settlements already created rather than from a schedule table: there is no
   * settlement calendar in this system, and inventing one would be a number with no source. When
   * nothing is in flight this is null and the screen says so, rather than promising a date nobody
   * has committed to.
   */
  readonly nextSettlement: { readonly reference: string; readonly netMinor: number } | null;
}

@Injectable()
export class MerchantBalanceService {
  constructor(
    @InjectDataSource('finance') private readonly finance: DataSource,
    @Inject(FinanceRepository) private readonly repository: FinanceRepository,
    @Inject(COD_LOOKUP)
    private readonly cod: { blocksFor(merchantId: string): Promise<Map<string, number>> },
  ) {}

  async execute(merchantId: string): Promise<MerchantBalance> {
    // Read `cod` first and outside the finance transaction: it is another module's schema on
    // another connection, and a blocking answer should cost nothing rather than roll one back.
    const blockers = await this.cod.blocksFor(merchantId);

    const { rows, currency, nextSettlement } = await this.finance.transaction(async (manager) => {
      const ledger = await this.repository.entriesFor(manager, merchantId);
      const pending = await this.repository.firstUnsettled(manager, merchantId);
      return {
        rows: ledger,
        currency: (ledger[0]?.currency ?? 'BDT') as Currency,
        nextSettlement: pending,
      };
    });

    const lines = balanceLines(
      rows.map((row) => ({
        type: row.entryType as LedgerEntryType,
        direction: Number(row.direction) as LedgerDirection,
        amountMinor: Number(row.amountMinor),
      })),
    );
    const balanceMinor = headlineBalance(
      rows.map((row) => ({
        direction: Number(row.direction) as LedgerDirection,
        amountMinor: Number(row.amountMinor),
      })),
    ).amountMinor;

    // Cheap, and it turns a future schema addition into a failed test rather than a merchant who
    // has been underpaid by ৳240 and cannot say why.
    assertLinesReconcile(lines, balanceMinor);

    return {
      merchantId,
      balanceMinor,
      currency,
      asOf: new Date().toISOString(),
      lines,
      blocked: [...blockers.entries()].map(([status, count]) => ({ status, count })),
      blockedReason: blockers.size > 0 ? describeBlock(blockers) : null,
      nextSettlement,
    };
  }
}
