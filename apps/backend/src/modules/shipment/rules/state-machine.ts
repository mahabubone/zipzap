/**
 * Shipment state machine. Framework-free: no @nestjs, no typeorm, no class-validator.
 *
 * A status column is never UPDATEd directly. It changes only through a transition that validates
 * the current state. See docs/architecture/state-machines.md and ADR-0002.
 *
 * `assertTransition` throws rather than returning a boolean: a caller that forgets to check a
 * boolean proceeds happily, whereas a caller that forgets to catch a throw fails loudly.
 */

import { InvalidTransitionError } from '../../../common/domain-error.ts';

export const SHIPMENT_STATUSES = [
  'DRAFT',
  'CREATED',
  'PICKUP_REQUESTED',
  'PICKUP_ASSIGNED',
  'PICKED_UP',
  'AT_ORIGIN_HUB',
  'SORTING',
  'DISPATCHED',
  'IN_TRANSIT',
  'AT_DESTINATION_HUB',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RETRY_SCHEDULED',
  // The return lifecycle is a parallel lifecycle on the SAME shipment, never a second parcel.
  // A delivered-then-returned shipment reached DELIVERED first: there are no backwards edges.
  'RETURN_INITIATED',
  'RETURN_IN_TRANSIT',
  'RETURN_AT_HUB',
  'RETURN_OUT_FOR_DELIVERY',
  'RETURNED',
  'ON_HOLD',
  'CANCELLED',
  'LOST',
  'DAMAGED',
  'EXCEPTION',
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/**
 * The transition table, as data.
 *
 * `ON_HOLD` is resumable and records the state it interrupted, so `release` returns a shipment
 * exactly where it was. That is a resume, not a backwards transition.
 */
export const TRANSITIONS = {
  DRAFT: ['CREATED', 'CANCELLED'],
  CREATED: ['PICKUP_REQUESTED', 'CANCELLED'],
  PICKUP_REQUESTED: ['PICKUP_ASSIGNED', 'CANCELLED'],
  PICKUP_ASSIGNED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['AT_ORIGIN_HUB', 'EXCEPTION'],
  AT_ORIGIN_HUB: ['SORTING', 'EXCEPTION'],
  SORTING: ['DISPATCHED', 'EXCEPTION'],
  DISPATCHED: ['IN_TRANSIT', 'EXCEPTION'],
  IN_TRANSIT: ['AT_DESTINATION_HUB', 'EXCEPTION', 'LOST'],
  AT_DESTINATION_HUB: ['OUT_FOR_DELIVERY', 'EXCEPTION'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED', 'RETURN_INITIATED', 'ON_HOLD'],
  DELIVERED: ['RETURN_INITIATED'],
  DELIVERY_FAILED: ['RETRY_SCHEDULED', 'RETURN_INITIATED', 'ON_HOLD'],
  RETRY_SCHEDULED: ['OUT_FOR_DELIVERY', 'RETURN_INITIATED', 'ON_HOLD'],
  RETURN_INITIATED: ['RETURN_IN_TRANSIT', 'CANCELLED'],
  RETURN_IN_TRANSIT: ['RETURN_AT_HUB', 'EXCEPTION'],
  RETURN_AT_HUB: ['RETURN_OUT_FOR_DELIVERY', 'EXCEPTION'],
  RETURN_OUT_FOR_DELIVERY: ['RETURNED', 'EXCEPTION'],
  RETURNED: [],
  ON_HOLD: [], // released back to the state recorded in held_from_status
  CANCELLED: [],
  LOST: [],
  DAMAGED: [],
  EXCEPTION: ['ON_HOLD', 'CANCELLED'],
} as const satisfies Readonly<Record<ShipmentStatus, readonly ShipmentStatus[]>>;

/**
 * Accepts no further transition of any kind.
 *
 * DELIVERED is deliberately NOT here. It is terminal for the *forward* path but can branch into
 * the return lifecycle, because a parcel that was delivered and then refused comes back. Treating
 * DELIVERED as absolutely terminal made the constant contradict the transition table — the two
 * must agree, or every caller of isTerminal() inherits the ambiguity.
 */
export const TERMINAL_STATUSES = ['RETURNED', 'CANCELLED', 'LOST'] as const;

/** End of the forward lifecycle. A return may still begin from DELIVERED. */
export const FORWARD_TERMINAL_STATUSES = ['DELIVERED', ...TERMINAL_STATUSES] as const;

export function canTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return (TRANSITIONS[from] as readonly ShipmentStatus[]).includes(to);
}

export function assertTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isTerminal(status: ShipmentStatus): boolean {
  return (TERMINAL_STATUSES as readonly ShipmentStatus[]).includes(status);
}

export function isForwardTerminal(status: ShipmentStatus): boolean {
  return (FORWARD_TERMINAL_STATUSES as readonly ShipmentStatus[]).includes(status);
}

/**
 * Has this shipment physically progressed past the origin network?
 *
 * The manifest reconciliation question, asked in shipment vocabulary so the
 * network module never imports this table or this enum — it asks the lookup
 * contract a yes/no question. Everything before the destination hub counts as
 * not-arrived; EXCEPTION and LOST count too, because reconciling a manifest
 * whose cargo is stuck or lost is exactly the silence this check exists to
 * prevent. Terminal handling states (CANCELLED, ON_HOLD, return leg, delivered)
 * count as arrived: the answer for those shipments is known.
 */
const PRE_DESTINATION: readonly ShipmentStatus[] = [
  'DRAFT',
  'CREATED',
  'PICKUP_REQUESTED',
  'PICKUP_ASSIGNED',
  'PICKED_UP',
  'AT_ORIGIN_HUB',
  'SORTING',
  'DISPATCHED',
  'IN_TRANSIT',
  'EXCEPTION',
  'LOST',
];

export function hasArrived(status: ShipmentStatus): boolean {
  return !PRE_DESTINATION.includes(status);
}

export function allowedFrom(status: ShipmentStatus): readonly ShipmentStatus[] {
  return TRANSITIONS[status];
}
