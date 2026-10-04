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
