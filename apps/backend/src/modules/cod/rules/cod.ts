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
  COD_EXPECTED: ['COD_COLLECTED', 'COLLECTION_FAILED', 'PARTIAL_COLLECTION'],
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
