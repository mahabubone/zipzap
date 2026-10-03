/**
 * Delivery attempt lifecycle. Framework-free.
 *
 * Failure is a branch, not an error: DELIVERY_FAILED is a normal outcome with a structured
 * reason that drives the next step — retry, reschedule, merchant contact, return, or
 * escalation. A free-text reason gives operations a string to read and nothing to act on.
 *
 * Some reasons are retryable and some are terminal. Retrying a wrong address burns rider time
 * and delays every parcel behind it.
 */

import { InvalidTransitionError } from '../../../common/domain-error.ts';

export const DELIVERY_STATUSES = [
  'CREATED',
  'ASSIGNED',
  'ACCEPTED',
  'OUT_FOR_DELIVERY',
  'ATTEMPTED',
  'DELIVERED',
  'FAILED',
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_TRANSITIONS = {
  CREATED: ['ASSIGNED', 'FAILED'],
  ASSIGNED: ['ACCEPTED', 'FAILED'],
  ACCEPTED: ['OUT_FOR_DELIVERY', 'FAILED'],
  OUT_FOR_DELIVERY: ['ATTEMPTED', 'FAILED'],
  ATTEMPTED: ['DELIVERED', 'FAILED', 'OUT_FOR_DELIVERY'],
  DELIVERED: [],
  FAILED: ['OUT_FOR_DELIVERY'],
} as const satisfies Readonly<Record<DeliveryStatus, readonly DeliveryStatus[]>>;

export function assertTransition(from: DeliveryStatus, to: DeliveryStatus): void {
  if (!(DELIVERY_TRANSITIONS[from] as readonly DeliveryStatus[]).includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export const FAILURE_REASONS = [
  'CUSTOMER_UNAVAILABLE',
  'WRONG_ADDRESS',
  'PHONE_UNREACHABLE',
  'CUSTOMER_REFUSED',
  'ADDRESS_INCOMPLETE',
  'PAYMENT_ISSUE',
  'DAMAGED_PACKAGE',
  'WEATHER',
  'OPERATIONAL_EXCEPTION',
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

/**
 * Retryable reasons go back out; terminal reasons end the job and trigger return.
 * The split is the policy: CUSTOMER_UNAVAILABLE retries, WRONG_ADDRESS does not.
 */
const RETRYABLE: ReadonlySet<FailureReason> = new Set([
  'CUSTOMER_UNAVAILABLE',
  'PHONE_UNREACHABLE',
  'ADDRESS_INCOMPLETE',
  'WEATHER',
  'OPERATIONAL_EXCEPTION',
]);

export function isRetryable(reason: FailureReason): boolean {
  return RETRYABLE.has(reason);
}

/** Attempts are bounded by policy. Exhaustion triggers return, never infinite retry. */
export const MAX_ATTEMPTS = 3;

export function attemptsRemain(attemptsMade: number): boolean {
  return attemptsMade < MAX_ATTEMPTS;
}
