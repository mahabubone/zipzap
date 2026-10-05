/**
 * Manifest lifecycle. Framework-free: no @nestjs, no typeorm.
 *
 * `DRAFT → SEALED → DISPATCHED → RECEIVED → RECONCILED`, linear and
 * forward-only — the same rule as every status column in the system: it moves
 * only through a transition that validates the current state. Reconciliation
 * is the last edge, and it is conditional: the service checks every cargo
 * item actually arrived before allowing it (see ManifestService).
 *
 * A sealed manifest is evidence of what left the hub. Items are append-only in
 * the database (delete trigger); this table says what may happen to the
 * manifest's status.
 */

import { InvalidTransitionError } from '../../../common/domain-error.ts';

export const MANIFEST_STATUSES = [
  'DRAFT',
  'SEALED',
  'DISPATCHED',
  'RECEIVED',
  'RECONCILED',
] as const;

export type ManifestStatus = (typeof MANIFEST_STATUSES)[number];

export const MANIFEST_TRANSITIONS = {
  DRAFT: ['SEALED'],
  SEALED: ['DISPATCHED'],
  DISPATCHED: ['RECEIVED'],
  RECEIVED: ['RECONCILED'],
  RECONCILED: [],
} as const satisfies Readonly<Record<ManifestStatus, readonly ManifestStatus[]>>;

export function canManifestTransition(from: ManifestStatus, to: ManifestStatus): boolean {
  return (MANIFEST_TRANSITIONS[from] as readonly ManifestStatus[]).includes(to);
}

/** Throws rather than returning a boolean — a forgotten check must fail loudly. */
export function assertManifestTransition(from: ManifestStatus, to: ManifestStatus): void {
  if (!canManifestTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isManifestTerminal(status: ManifestStatus): boolean {
  return status === 'RECONCILED';
}
