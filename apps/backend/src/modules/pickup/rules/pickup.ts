/**
 * Pickup request lifecycle. Framework-free.
 *
 * A pickup is a first-class workflow, not an implicit side effect of shipment creation.
 * One assignment covers many parcels (batching); the batch owns its membership, so adding a
 * parcel after assignment is a batch operation with its own rules — never a silent insertion
 * into an in-flight job.
 */

import { InvalidTransitionError } from '../../../common/domain-error.ts';

export const PICKUP_STATUSES = [
  'REQUESTED',
  'SCHEDULED',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
] as const;

export type PickupStatus = (typeof PICKUP_STATUSES)[number];

export const PICKUP_TRANSITIONS = {
  REQUESTED: ['SCHEDULED', 'CANCELLED', 'EXPIRED'],
  SCHEDULED: ['ASSIGNED', 'CANCELLED', 'EXPIRED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['SCHEDULED'],
  EXPIRED: [],
  CANCELLED: [],
} as const satisfies Readonly<Record<PickupStatus, readonly PickupStatus[]>>;

export function canTransition(from: PickupStatus, to: PickupStatus): boolean {
  return (PICKUP_TRANSITIONS[from] as readonly PickupStatus[]).includes(to);
}

export function assertTransition(from: PickupStatus, to: PickupStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/** Batching is bounded — by count, weight, or time. An unbounded batch is one merchant
 * deciding a rider's entire day. */
export const MAX_BATCH_PARCELS = 50;
export const MAX_BATCH_WEIGHT_GRAMS = 75_000;

export interface PickupBatchInput {
  readonly shipmentIds: readonly string[];
  readonly totalWeightGrams: number;
}

export function validateBatch(input: PickupBatchInput): void {
  if (input.shipmentIds.length === 0) {
    throw new Error('A batch must contain at least one shipment.');
  }
  if (input.shipmentIds.length > MAX_BATCH_PARCELS) {
    throw new Error(
      `Batch of ${input.shipmentIds.length} exceeds the maximum of ${MAX_BATCH_PARCELS}.`,
    );
  }
  if (input.totalWeightGrams > MAX_BATCH_WEIGHT_GRAMS) {
    throw new Error(`Batch weight ${input.totalWeightGrams}g exceeds the maximum.`);
  }
}
