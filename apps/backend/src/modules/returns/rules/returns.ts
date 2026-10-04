/**
 * Return lifecycle. Framework-free: no @nestjs, no typeorm, no class-validator.
 *
 * A return references the original shipment — never a second, unrelated parcel.
 * The forward lifecycle is never rewound: a delivered-then-returned shipment
 * reached DELIVERED first. History is a chain of forward moves.
 *
 * Two halves, one chain: the DECISION (REQUESTED -> APPROVED or REJECTED — approval
 * is explicit because it moves money) then the CUSTODY (INITIATED -> IN_TRANSIT ->
 * AT_HUB -> OUT_FOR_DELIVERY -> RETURNED, mirroring the forward legs backwards).
 * REJECTED and RETURNED are both terminal. A rejected return is re-requested, never
 * reopened.
 *
 * Vocabulary merged 2026-10-04: returns.md + ROADMAP named the decision half,
 * state-machines.md named the custody half with different legs (TO_MERCHANT was a
 * status masquerading as a leg). This table is the merged source; both docs now
 * point here.
 */

import { InvalidTransitionError } from '../../../common/domain-error.ts';

export const RETURN_STATUSES = [
  'RETURN_REQUESTED',
  'RETURN_APPROVED',
  'RETURN_REJECTED',
  'RETURN_INITIATED',
  'RETURN_IN_TRANSIT',
  'RETURN_AT_HUB',
  'RETURN_OUT_FOR_DELIVERY',
  'RETURNED',
] as const;

export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const RETURN_TRANSITIONS = {
  RETURN_REQUESTED: ['RETURN_APPROVED', 'RETURN_REJECTED'],
  RETURN_APPROVED: ['RETURN_INITIATED'],
  RETURN_REJECTED: [],
  RETURN_INITIATED: ['RETURN_IN_TRANSIT'],
  RETURN_IN_TRANSIT: ['RETURN_AT_HUB'],
  RETURN_AT_HUB: ['RETURN_OUT_FOR_DELIVERY'],
  RETURN_OUT_FOR_DELIVERY: ['RETURNED'],
  RETURNED: [],
} as const satisfies Readonly<Record<ReturnStatus, readonly ReturnStatus[]>>;

export function canTransition(from: ReturnStatus, to: ReturnStatus): boolean {
  return (RETURN_TRANSITIONS[from] as readonly ReturnStatus[]).includes(to);
}

export function assertTransition(from: ReturnStatus, to: ReturnStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export const RETURN_REASONS = [
  'CUSTOMER_REFUSED',
  'CUSTOMER_UNAVAILABLE',
  'WRONG_ADDRESS',
  'DAMAGED',
  'MERCHANT_REQUEST',
  'OTHER',
] as const;

export type ReturnReason = (typeof RETURN_REASONS)[number];
