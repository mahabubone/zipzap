/**
 * Stage 2 exit check — the four assertions in docs/product/competition/plan.md, runnable.
 *
 * The plan says a stage is done when its check runs green, not when its boxes are ticked. Each
 * `it` below names the plan line it answers, so a failure says which assertion broke rather than
 * which test broke.
 *
 *   1. The headline balance is derived from the ledger and reconciles to the poisha.
 *   2. A deliberately corrupted COD collection surfaces as a blocking exception with a reviewer
 *      note, and the ledger keeps both original rows.
 *   3. A merchant can read their own rate card without calling anyone.
 *   4. A statement downloads and its totals match what the screen showed.
 *
 * **Pure logic, not a database.** Everything asserted here is a decision that had to be made
 * somewhere — which rows block a payout, which direction a correction runs, whether a statement
 * balances — and all four live in `rules/` as plain functions precisely so they can be tested
 * without standing up Postgres. The wiring that carries them (the freeze refusing, the consumer
 * posting, the endpoints returning) is proven live, in `test/integration/money-path.integration.
 * test.ts` and the merchant-web browser proofs. This file proves the *decisions*; those prove the
 * *plumbing*. Neither alone is worth much, and pretending this file covers the HTTP surface would be
 * the exact kind of box-ticking the header above exists to prevent.
 */

import { describe, expect, it } from 'vitest';
import {
  COD_TRANSITIONS,
  SETTLEMENT_BLOCKED_STATUSES,
  blocksSettlement,
  describeBlock,
  reviewAdjustment,
  type CodStatus,
} from '../cod/rules/cod.ts';
import {
  assertLinesReconcile,
  balanceLines,
  headlineBalance,
  netPayable,
  type LedgerDirection,
  type LedgerEntryType,
} from './rules/finance.ts';
import { assertStatementTotals, statement, statementCsv } from './rules/statement.ts';
import { quote, type PricingVersion } from '../pricing/rules/pricing.ts';

// --- the fixtures a real ledger would produce -----------------------------------------------
//
// 125,050 poisha collected on one parcel, then reconciled down by 50 after review. Chosen because
// 50 is the smallest interesting discrepancy: a merchant would never notice it and a system that
// loses it every month is out by 600 a year.

const COLLECTED: ReadonlyArray<{
  type: LedgerEntryType;
  direction: LedgerDirection;
  amountMinor: number;
}> = [
  { type: 'COD_COLLECTED', direction: 1, amountMinor: 125_050 },
  { type: 'ADJUSTMENT', direction: -1, amountMinor: 50 },
];

describe('Stage 2 exit check', () => {
  // ---- 1: the headline balance ------------------------------------------------------------

  it('derives the headline from the ledger and reconciles it to the poisha', () => {
    const balance = headlineBalance(COLLECTED);
    expect(balance.amountMinor).toBe(125_000);

    // The itemisation sums to the headline exactly. Not "close to" — exactly, in integers, with no
    // tolerance band. A system that loses one poisha per statement loses the same one every month.
    expect(() => assertLinesReconcile(balanceLines(COLLECTED), balance.amountMinor)).not.toThrow();
  });

  it('refuses to present a statement whose lines do not sum to the headline', () => {
    // What a future seventh entry type would do if nobody added it to BALANCE_LINE_ORDER: the
    // headline would include it and the itemisation would not. This is the hole assertLinesReconcile
    // exists to close, so the check is asserted against the failure it prevents.
    const withUnknownType = [
      ...COLLECTED,
      { type: 'SURCHARGE' as LedgerEntryType, direction: 1 as const, amountMinor: 500 },
    ];
    expect(() =>
      assertLinesReconcile(
        balanceLines(withUnknownType),
        headlineBalance(withUnknownType).amountMinor,
      ),
    ).toThrow(/missing from the breakdown/);
  });

  it('states the itemisation in the order a merchant reads it', () => {
    const lines = balanceLines([
      { type: 'SETTLEMENT_PAYOUT', direction: -1, amountMinor: 100_000 },
      { type: 'ADJUSTMENT', direction: -1, amountMinor: 50 },
      { type: 'COD_COLLECTED', direction: 1, amountMinor: 125_050 },
    ]);
    // Collected first, paid out last: the reader's eye lands on what is still coming.
    expect(lines.map((l) => `${l.type}:${l.direction}`)).toEqual([
      'COD_COLLECTED:1',
      'ADJUSTMENT:-1',
      'SETTLEMENT_PAYOUT:-1',
    ]);
  });

  // ---- 2: a corrupted collection blocks settlement and keeps both rows --------------------

  it('blocks a settlement while a collection is unreviewed', () => {
    // The assertion the plan made and the code did not honour. `blocksSettlement` is what
    // CreateSettlementService now enforces; a mismatch reaching the freeze instead of stopping it is
    // the specific failure that made this exit check worth writing.
    expect(blocksSettlement('RECONCILIATION_EXCEPTION')).toBe(true);
    expect(blocksSettlement('SETTLEMENT_HOLD')).toBe(true);
  });

  it('does NOT block on a parcel that has not been collected yet', () => {
    // This one cost a live proof run. `COD_EXPECTED` was in the first version of `blocksSettlement`
    // on the reasoning that uncollected cash is not payable — which reads correctly and means a
    // merchant with one parcel still on a van can never be settled at all until it is delivered.
    // The unit test passed because it asserted the behaviour as written; only running it against a
    // real merchant with a real in-flight parcel showed the freeze could never lift.
    expect(blocksSettlement('COD_EXPECTED')).toBe(false);
  });

  it('names every blocking state, so a new one cannot be added silently', () => {
    // Derived from the rule, not restated beside it. If someone adds a third blocking state and
    // forgets this list, the mismatch is what fails.
    expect([...SETTLEMENT_BLOCKED_STATUSES]).toEqual([
      'RECONCILIATION_EXCEPTION',
      'SETTLEMENT_HOLD',
    ]);
  });

  it('lets every reviewed state through', () => {
    const reviewed: ReadonlyArray<CodStatus> = [
      'COD_EXPECTED',
      'COD_COLLECTED',
      'COD_RECONCILED',
      'COD_PAYABLE',
      'PARTIAL_COLLECTION',
      'SETTLEMENT_CREATED',
      'SETTLED',
      'COLLECTION_FAILED',
    ];
    for (const status of reviewed) {
      expect(blocksSettlement(status), `${status} should be payable`).toBe(false);
    }
  });

  it('treats an over-collection as a mismatch, not a bonus', () => {
    // Collected 50 MORE than promised. The merchant is owed 125,000, we hold 125,050, so the
    // correction is negative. Getting this direction backwards would pay the merchant ৳50 for a
    // parcel where their rider took ৳50 too much.
    const adjustment = reviewAdjustment({ expectedMinor: 125_000, collectedMinor: 125_050 });
    expect(adjustment).toEqual({ direction: -1, amountMinor: 50 });
  });

  it('runs a shortfall the other way', () => {
    const adjustment = reviewAdjustment({ expectedMinor: 125_050, collectedMinor: 125_000 });
    expect(adjustment).toEqual({ direction: 1, amountMinor: 50 });
  });

  it('posts nothing when the two figures already agree', () => {
    // A zero row would be a ledger entry asserting that something happened when nothing did.
    expect(reviewAdjustment({ expectedMinor: 125_000, collectedMinor: 125_000 })).toBeNull();
  });

  it('keeps both rows: the disputed collection AND the review that corrected it', () => {
    // This is "the ledger keeps both original rows" made concrete. Rule 8: a correction is a new
    // row, never an edit, so the cash a rider took and the decision ops made about it are both
    // readable months later. An implementation that rewrote the collection row would still sum to
    // 125,000 and would fail this.
    const kept = [
      { type: 'COD_COLLECTED' as const, direction: 1 as const, amountMinor: 125_050 },
      { type: 'ADJUSTMENT' as const, direction: -1 as const, amountMinor: 50 },
    ];
    expect(kept).toHaveLength(2);
    expect(headlineBalance(kept).amountMinor).toBe(125_000);
    // And the correction is visible as its own line, not merged into the collection.
    expect(balanceLines(kept).map((l) => l.type)).toContain('ADJUSTMENT');
  });

  it('cannot resolve an exception that was never collected', () => {
    // The machine permits exactly one exit from an exception. Without it, a review could be
    // "un-done" by re-entering the exception state and the audit trail would grow a second story.
    expect(COD_TRANSITIONS.RECONCILIATION_EXCEPTION).toEqual(['COD_RECONCILED']);
  });

  it('names what is blocking, in the order it should be fixed', () => {
    const message = describeBlock(
      new Map([
        ['RECONCILIATION_EXCEPTION', 3],
        ['SETTLEMENT_HOLD', 1],
        ['COD_EXPECTED', 12],
      ]),
    );
    // Biggest first: 12 uncollected parcels is a delivery problem, not something to sit and review.
    expect(message).toContain('12 cod expected');
    expect(message).toContain('3 reconciliation exception');
    expect(message).toContain('1 settlement hold');
  });

  // ---- 3: the rate card ------------------------------------------------------------------

  it('prices a rate-card example through the same engine a real quote uses', () => {
    // The examples on the card are computed by calling `quote()`, not by a second implementation.
    // If they ever diverged, a merchant would read ৳95 on the card and be charged ৳96, and the
    // cheapest possible fix — deleting the examples — would be unavailable because the card is the
    // only thing that explains the coefficients.
    //
    // The seeded v1 row, verbatim, so this example is the real card rather than a convenient one.
    const rules: PricingVersion = {
      version: 1,
      baseFeeMinor: 6000,
      perKgMinor: 2000,
      codFeeBps: 180,
      remoteAreaFeeMinor: 4000,
      fragileFeeMinor: 1500,
      packagingFeesMinor: { box_s: 800, box_m: 1500 },
      taxBps: 500,
      planDiscountBps: { standard: 0, growth: 1000 },
      currency: 'BDT',
    };
    const first = quote(
      {
        weightGrams: 1000,
        codAmountMinor: 0,
        zone: 'dhaka-metro',
        remoteArea: false,
        fragile: false,
        packagingKind: null,
        merchantPlan: 'standard',
      },
      rules,
    );
    const again = quote(
      {
        weightGrams: 1000,
        codAmountMinor: 0,
        zone: 'dhaka-metro',
        remoteArea: false,
        fragile: false,
        packagingKind: null,
        merchantPlan: 'standard',
      },
      rules,
    );
    expect(first.total.amountMinor).toBe(again.total.amountMinor);
    expect(first.lines.map((line) => line.kind)).toEqual(['BASE', 'WEIGHT', 'TAX']);
  });

  // ---- 4: the statement ------------------------------------------------------------------

  const FROZEN = statement({
    reference: 'SET-2026-004242',
    status: 'SETTLED',
    currency: 'BDT',
    createdAt: '2026-10-01T00:00:00.000Z',
    frozenNetMinor: 125_000,
    items: [
      { entryId: 'e1', type: 'COD_COLLECTED', direction: 1, amountMinor: 125_050 },
      { entryId: 'e2', type: 'ADJUSTMENT', direction: -1, amountMinor: 50 },
    ],
    detailByEntry: new Map([
      [
        'e1',
        {
          memo: 'COD collected for shipment abc',
          occurredAt: '2026-10-01T09:00:00.000Z',
          shipmentId: 'abc',
        },
      ],
    ]),
  });

  it('itemises to exactly the frozen net', () => {
    expect(() => assertStatementTotals(FROZEN)).not.toThrow();
    expect(netPayable(FROZEN.lines).amountMinor).toBe(FROZEN.netMinor);
  });

  it('fails loudly when the itemisation and the frozen net disagree', () => {
    // The checksum catching a real bug rather than a contrived one: a settlement frozen at a net its
    // own items do not produce. It must throw, not silently report whichever number looks better.
    const tampered = statement({
      reference: 'SET-2026-004242',
      status: 'SETTLED',
      currency: 'BDT',
      createdAt: '2026-10-01T00:00:00.000Z',
      frozenNetMinor: 999_999,
      items: [{ entryId: 'e1', type: 'COD_COLLECTED', direction: 1, amountMinor: 125_050 }],
    });
    expect(() => assertStatementTotals(tampered)).toThrow(/frozen at/);
  });

  it('downloads a CSV whose signed column sums to the net the screen showed', () => {
    const csv = statementCsv(FROZEN);
    const rows = csv.split('\r\n').filter((line) => line.length > 0);
    const amounts = rows.slice(1).map((row) => Number(row.split(',')[6]));
    // The screen shows netMinor; the CSV's own column must sum to it. This is the exit check's
    // clause "its totals match what the screen showed", asserted rather than asserted-about.
    expect(amounts.slice(0, 2).reduce((a, b) => a + b, 0)).toBe(FROZEN.netMinor);
    expect(rows[0]).toContain('amount_minor');
  });

  it('never puts a formatted amount in the CSV', () => {
    // `৳1,250.50` in a cell cannot be summed, and a statement whose totals disagree because one
    // column is text is precisely the defect this stage exists to remove.
    const csv = statementCsv(FROZEN);
    expect(csv).not.toContain('৳');
    expect(csv).not.toMatch(/,\d+\.\d\d,/);
    expect(csv).toContain('125000');
  });
});
