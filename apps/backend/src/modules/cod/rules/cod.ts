/**
 * COD lifecycle. Framework-free: no @nestjs, no typeorm, no class-validator.
 *
 * A status column is never UPDATEd directly. It changes only through a transition that validates
 * the current state. See docs/architecture/state-machines.md and ADR-0002.
 *
 * `assertTransition` throws rather than returning a boolean: a caller that forgets to check a
 * boolean proceeds happily, whereas a caller that forgets to catch a throw fails loudly.
 */

import { InvalidTransitionError } from '../../../common/domain-error.ts';

export const COD_STATUSES = [
  'COD_EXPECTED',
  'COD_COLLECTED',
  'COD_RECONCILED',
  'COD_PAYABLE',
  'SETTLEMENT_CREATED',
  'SETTLED',
  'COLLECTION_FAILED',
  'PARTIAL_COLLECTION',
  'RECONCILIATION_EXCEPTION',
  'SETTLEMENT_HOLD',
] as const;

export type CodStatus = (typeof COD_STATUSES)[number];

/**
 * The transition table, as data.
 *
 * Forward motion is the happy path. COLLECTION_FAILED and PARTIAL_COLLECTION are terminal
 * records of what happened, not error states to be retried through — a short collection is
 * settled at the collected amount with the shortfall visible, never invented.
 */
export const COD_TRANSITIONS = {
  COD_EXPECTED: [
    'COD_COLLECTED',
    'COLLECTION_FAILED',
    'PARTIAL_COLLECTION',
    'RECONCILIATION_EXCEPTION',
  ],
  COD_COLLECTED: ['COD_RECONCILED', 'RECONCILIATION_EXCEPTION'],
  COD_RECONCILED: ['COD_PAYABLE'],
  COD_PAYABLE: ['SETTLEMENT_CREATED', 'SETTLEMENT_HOLD'],
  SETTLEMENT_CREATED: ['SETTLED'],
  SETTLED: [],
  COLLECTION_FAILED: [],
  PARTIAL_COLLECTION: ['COD_RECONCILED'],
  RECONCILIATION_EXCEPTION: ['COD_RECONCILED'],
  SETTLEMENT_HOLD: ['COD_PAYABLE'],
} as const satisfies Readonly<Record<CodStatus, readonly CodStatus[]>>;

export function canTransition(from: CodStatus, to: CodStatus): boolean {
  return (COD_TRANSITIONS[from] as readonly CodStatus[]).includes(to);
}

export function assertTransition(from: CodStatus, to: CodStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export interface ReconcileInput {
  /** What the quote promised, in minor units. Never overwritten by collection. */
  readonly expectedMinor: number;
  /** What the rider actually handed back, in minor units. */
  readonly collectedMinor: number;
}

export type ReconcileOutcome =
  | { readonly kind: 'MATCHED' }
  | { readonly kind: 'PARTIAL'; readonly shortfallMinor: number }
  | { readonly kind: 'MISMATCH'; readonly shortfallMinor: number };

/**
 * Pure comparison of promise against reality. No database, no side effects, no floats.
 *
 * A collected amount ABOVE expected is a mismatch, not a bonus — over-collection is as wrong
 * as under-collection, and both must surface rather than settle silently.
 */
export function reconcile(input: ReconcileInput): ReconcileOutcome {
  if (input.collectedMinor === input.expectedMinor) return { kind: 'MATCHED' };
  const shortfallMinor = input.expectedMinor - input.collectedMinor;
  if (shortfallMinor > 0) return { kind: 'PARTIAL', shortfallMinor };
  return { kind: 'MISMATCH', shortfallMinor };
}

/**
 * The compensating entry a review posts, or null when the two figures already agree.
 *
 * A mismatch puts **both** facts in the ledger: the collection row for the cash the rider actually
 * took, and this adjustment for the difference a reviewer settled on. Neither is rewritten — rule
 * 8. That is what makes the exit check's "the ledger keeps both original rows" true rather than
 * aspirational, and it is why the collection row is posted at all even when the collection was bad:
 * money a rider physically holds is a fact about the world, and hiding it because it is disputed is
 * how a ৳50 theft becomes invisible.
 *
 * The adjustment is the difference between what was collected and what is owed, and its direction
 * follows from that difference:
 *
 *   collected > expected  (over-collection) → the merchant is owed LESS than we hold. direction -1.
 *   collected < expected  (shortfall)      → the merchant is owed MORE than we hold. direction +1.
 *   collected = expected                   → null. Nothing to post; inventing a zero row would
 *                                            be a ledger entry that says nothing happened.
 *
 * `expectedMinor` is the promise from the frozen quote and never moves. The reviewer chooses
 * between the two figures and records why; this function does not decide for them.
 */
export function reviewAdjustment(input: {
  readonly expectedMinor: number;
  readonly collectedMinor: number;
}): { readonly direction: 1 | -1; readonly amountMinor: number } | null {
  const difference = input.collectedMinor - input.expectedMinor;
  if (difference === 0) return null;
  return {
    // Over-collection means we hold cash the merchant is not owed, so the correction is negative.
    direction: difference > 0 ? -1 : 1,
    amountMinor: Math.abs(difference),
  };
}

/**
 * Whether a COD record's state may be included in a settlement freeze.
 *
 * This is the exit check made runnable: a collection that was never reconciled must not be paid
 * out. Before this function existed, `finance.create-settlement.service.ts` read only the ledger,
 * and a MISMATCH never reached the ledger at all — so an unreviewed mismatch did not block the
 * payout, it silently *shrank* it. The merchant was paid for everything else while ৳50 of their
 * money sat in a state nobody was looking at. That is the opposite of blocking.
 *
 * The rule lives here, in `rules/`, because it is a business rule and not a query: the repository
 * decides WHICH rows, this decides whether a row may be frozen. A settlement that paid out an
 * unreviewed exception is wrong even if the SQL was right.
 *
 * Exactly two states block, and both mean a human has to decide something:
 *
 *   - `RECONCILIATION_EXCEPTION` — the cash and the quote disagree and nobody has looked.
 *   - `SETTLEMENT_HOLD` — somebody deliberately stopped it.
 *
 * **`COD_EXPECTED` does NOT block, and getting that wrong is worse than not blocking at all.** It
 * was in the first version of this function, on the reasoning that uncollected cash is not payable.
 * That reads correctly and is wrong: `COD_EXPECTED` is the ordinary state of every parcel still on
 * a van, so a merchant with one parcel in transit could never be settled *at all* until that parcel
 * was delivered. The live proof caught it; the unit test did not, because the unit test asserted the
 * behaviour I had written. A block that can never clear is a freeze, not a control.
 */
export function blocksSettlement(status: CodStatus): boolean {
  return status === 'RECONCILIATION_EXCEPTION' || status === 'SETTLEMENT_HOLD';
}

/**
 * The statuses that block a freeze, derived from the rule rather than restated beside it.
 *
 * Exported so the exit check can assert the two halves together: this list is exactly
 * `COD_STATUSES.filter(blocksSettlement)`. A third blocking state added to the function without
 * appearing here would otherwise be invisible in review — which is how `COD_EXPECTED` survived
 * long enough to need the live proof to find it.
 */
export const SETTLEMENT_BLOCKED_STATUSES: readonly CodStatus[] =
  COD_STATUSES.filter(blocksSettlement);

/**
 * Why a settlement was refused, in the merchant's terms.
 *
 * `ReadonlyMap<string, number>` rather than `ReadonlyMap<CodStatus, number>` on purpose. The only
 * producer is `CodLookup.blocksFor`, whose return type is a plain string map, and typing this
 * against the union would force every caller to cast its way back out — a cast at a boundary is
 * where a wrong key survives. The strings here are read, compared and lower-cased; nothing switches
 * on them, so the union would buy nothing.
 *
 * The count is the actionable part: "resolve 3 exceptions" tells an operator what to do next,
 * where "no unsettled collections" tells them nothing and reads like the system is broken. Sorted
 * by count descending so the biggest thing to fix is named first.
 */
export function describeBlock(counts: ReadonlyMap<string, number>): string {
  const parts = [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `${count} ${status.toLowerCase().replace(/_/g, ' ')}`);
  if (parts.length === 0) return 'No collections are eligible for settlement.';
  return `Settlement is blocked by unreviewed collections: ${parts.join(', ')}.`;
}

/**
 * Maps a reconcile outcome to the next lifecycle state. Kept beside the table so the mapping
 * is reviewed with the machine, not scattered across services.
 */
export function nextAfterReconcile(outcome: ReconcileOutcome): CodStatus {
  switch (outcome.kind) {
    case 'MATCHED':
      return 'COD_COLLECTED';
    case 'PARTIAL':
      return 'PARTIAL_COLLECTION';
    case 'MISMATCH':
      return 'RECONCILIATION_EXCEPTION';
  }
}
