/**
 * Merchant lifecycle. Framework-free.
 *
 * State changes are validated, never assigned. Suspension is reversible and audited, and it
 * blocks new shipments while leaving in-flight parcels alone — suspending a merchant must not
 * orphan something already on a truck.
 */

export const MERCHANT_STATUSES = [
  'APPLIED',
  'UNDER_REVIEW',
  'VERIFIED',
  'ACTIVE',
  'SUSPENDED',
] as const;

export type MerchantStatus = (typeof MERCHANT_STATUSES)[number];

export const MERCHANT_TRANSITIONS = {
  APPLIED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['VERIFIED'],
  VERIFIED: ['ACTIVE'],
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE'],
} as const satisfies Readonly<Record<MerchantStatus, readonly MerchantStatus[]>>;

export function canTransition(from: MerchantStatus, to: MerchantStatus): boolean {
  return (MERCHANT_TRANSITIONS[from] as readonly MerchantStatus[]).includes(to);
}

/** Whether this merchant may create new shipments right now. */
export function canAcceptShipments(status: MerchantStatus): boolean {
  return status === 'ACTIVE';
}
