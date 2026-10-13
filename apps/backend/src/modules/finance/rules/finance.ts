/**
 * Ledger and settlement rules. Framework-free: no @nestjs, no typeorm, no class-validator.
 *
 * Two invariants, both load-bearing:
 *
 * 1. The ledger is append-only. Corrections are compensating entries: the wrong row stays
 *    visible, a new row explains it, and the sum is correct. A ledger that rewrites history
 *    cannot answer "what happened", and a ledger that cannot answer that cannot settle a
 *    dispute — which is the entire purpose.
 *
 * 2. A settlement is a frozen view, not a recalculation. An approved settlement is a contract.
 *    Late money lands in the next settlement. Rewriting an approved settlement underneath a
 *    merchant who has already been paid against it is not a correction, it is a second,
 *    unaudited payment run.
 */

import { InvalidTransitionError } from '../../../common/domain-error.ts';
import { add, money, type Money } from '../../../common/money.ts';

export const LEDGER_ENTRY_TYPES = [
  'COD_COLLECTED',
  'DELIVERY_FEE',
  'COD_FEE',
  'RETURN_FEE',
  'ADJUSTMENT',
  'SETTLEMENT_PAYOUT',
] as const;

export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

/** +1 credits the merchant, -1 debits them. Never derived from a value that could be zero. */
export type LedgerDirection = 1 | -1;

export interface LedgerEntryInput {
  readonly merchantId: string;
  readonly type: LedgerEntryType;
  readonly direction: LedgerDirection;
  readonly amountMinor: number;
  readonly currency: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly memo?: string;
}

export function validateLedgerEntry(input: LedgerEntryInput): void {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('Ledger amounts must be positive integers in minor units.');
  }
  if (input.direction !== 1 && input.direction !== -1) {
    throw new Error('Ledger direction must be +1 or -1.');
  }
  if (input.referenceId.trim().length === 0 || input.referenceType.trim().length === 0) {
    throw new Error('Every ledger entry must reference its source.');
  }
}

export const SETTLEMENT_STATUSES = [
  'CREATED',
  'APPROVED',
  'PAYMENT_INITIATED',
  'PAYMENT_CONFIRMED',
  'SETTLED',
] as const;

export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const SETTLEMENT_TRANSITIONS = {
  CREATED: ['APPROVED'],
  APPROVED: ['PAYMENT_INITIATED'],
  PAYMENT_INITIATED: ['PAYMENT_CONFIRMED'],
  PAYMENT_CONFIRMED: ['SETTLED'],
  SETTLED: [],
} as const satisfies Readonly<Record<SettlementStatus, readonly SettlementStatus[]>>;

export function assertSettlementTransition(from: SettlementStatus, to: SettlementStatus): void {
  if (!(SETTLEMENT_TRANSITIONS[from] as readonly SettlementStatus[]).includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/**
 * Net payable from a frozen item list. Integer arithmetic only — the same rule as everywhere
 * money moves. The remainder-allocation problem does not arise here because items are already
 * exact; this sum only proves no entry was lost or double-counted in the freeze.
 */
export function netPayable(
  items: ReadonlyArray<{ direction: LedgerDirection; amountMinor: number }>,
): Money {
  return items.reduce(
    (sum, item) =>
      item.direction === 1 ? add(sum, money(item.amountMinor)) : add(sum, money(-item.amountMinor)),
    money(0),
  );
}

/** One line of the itemised breakdown behind the headline number. */
export interface BalanceLine {
  readonly type: LedgerEntryType;
  readonly direction: LedgerDirection;
  readonly amountMinor: number;
  /** How many ledger rows made up this line. A count, so a ৳1 difference is traceable to one row. */
  readonly entries: number;
}

/**
 * The itemised breakdown, in the order RedX's invoice model uses and the order a merchant reads
 * them in: what we collected, what we charge, what we adjust, what we already paid.
 *
 * The order is not cosmetic. "Collected" first and "paid out" last means the reader's eye lands on
 * what is still coming rather than on what has already gone, which is the figure people open a
 * settlement screen to find.
 *
 * Lines with no rows are omitted rather than zero-filled: an empty "COD fee ৳0.00" teaches a
 * merchant that we charge a fee, and then they look for it on the next statement where it is absent.
 */
export const BALANCE_LINE_ORDER: readonly LedgerEntryType[] = [
  'COD_COLLECTED',
  'DELIVERY_FEE',
  'COD_FEE',
  'RETURN_FEE',
  'ADJUSTMENT',
  'SETTLEMENT_PAYOUT',
];

/**
 * Groups ledger rows into the itemised breakdown.
 *
 * This is what makes the headline checkable. `balanceMinor` is a bare sum, and a bare sum is a
 * number a merchant cannot argue with — the only response available to "that is wrong" is "no".
 * The breakdown is the same sum, itemised, so a disagreement becomes "your delivery fees say ৳240
 * and mine say ৳180", which is a question with an answer.
 *
 * The headline is `netPayable` over EVERY row, not over the grouped lines. Grouping happens first
 * and the total is derived from the groups, so a type missing from `BALANCE_LINE_ORDER` would
 * silently vanish from the statement while still being in the balance — two numbers that disagree,
 * which is the exact failure this is meant to prevent. `assertLinesReconcile` closes that hole.
 */
export function balanceLines(
  rows: ReadonlyArray<{
    type: LedgerEntryType;
    direction: LedgerDirection;
    amountMinor: number;
  }>,
): ReadonlyArray<BalanceLine> {
  const totals = new Map<string, { amountMinor: number; entries: number }>();
  for (const row of rows) {
    const key = `${row.type}:${row.direction}`;
    const seen = totals.get(key) ?? { amountMinor: 0, entries: 0 };
    totals.set(key, { amountMinor: seen.amountMinor + row.amountMinor, entries: seen.entries + 1 });
  }

  return BALANCE_LINE_ORDER.flatMap((type) =>
    ([1, -1] as const)
      .map((direction) => {
        const seen = totals.get(`${type}:${direction}`);
        return seen === undefined
          ? null
          : { type, direction, amountMinor: seen.amountMinor, entries: seen.entries };
      })
      .filter((line): line is BalanceLine => line !== null),
  );
}

/**
 * The headline, derived from the same grouped rows the breakdown shows.
 *
 * Taken over the raw rows rather than the lines, so the two can never drift: a type the breakdown
 * forgot still counts here, and `assertLinesReconcile` then fails loudly instead of the merchant
 * quietly being underpaid.
 */
export function headlineBalance(
  rows: ReadonlyArray<{
    direction: LedgerDirection;
    amountMinor: number;
  }>,
): Money {
  return netPayable(rows);
}

/**
 * The invariant that makes the statement trustworthy: the itemised lines sum to exactly the
 * headline. Not approximately — exactly, in integer minor units, with no tolerance band.
 *
 * A poisha is the smallest unit and it is worth nothing on its own, but a system that loses one
 * loses the same one every time and nobody notices for a month. The check is cheap and it is the
 * difference between a statement and an assertion.
 */
export function assertLinesReconcile(
  lines: ReadonlyArray<{ direction: LedgerDirection; amountMinor: number }>,
  headlineMinor: number,
): void {
  const sum = netPayable(lines).amountMinor;
  if (sum !== headlineMinor) {
    throw new Error(
      `The itemised statement sums to ${sum} but the headline balance is ${headlineMinor}. ` +
        'A ledger row is missing from the breakdown — every entry type must appear in ' +
        'BALANCE_LINE_ORDER.',
    );
  }
}
