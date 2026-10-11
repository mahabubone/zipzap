/**
 * What a rider may do to a job right now, and what the app may therefore offer.
 *
 * Pure, by AGENTS.md's rule 3. This is the rider half of a property the hub console already has and
 * the rider app does not: **the UI never offers an action the state machine will refuse.** A button
 * that returns `409 INVALID_TRANSITION` after a long queue round trip is worse than a missing
 * button, because the rider has already committed to the gesture.
 *
 * The transitions below mirror the server's, which refuses an illegal edge by naming both states.
 * The server remains the authority; this exists so the rider is not asked to discover that authority
 * one rejection at a time, in a dead zone, with a queue to unwind.
 *
 * An unrecognised state returns `[]` — offer nothing. That is the fail-closed direction: the state
 * may be one the client learned about before the server added a transition to it, and the safe thing
 * is to let the server speak. Showing every action would be the optimistic direction, and an
 * optimistic action is one that fails.
 */

import type { JobRow } from '../screens/JobsScreen.tsx';

/** One thing a rider can do to this job. */
export interface JobAction {
  readonly id: 'scan' | 'fail' | 'deliver';
  /** The one line shown under the title. This is what makes a single option legible. */
  readonly label: string;
  readonly detail: string;
  readonly icon: 'scan-outline' | 'alert-circle-outline' | 'camera-outline';
  /** The visual weight. Exactly one action is `primary` at a time. */
  readonly weight: 'primary' | 'secondary';
  /** A colour that says what happens if it goes wrong. */
  readonly tone: 'brand' | 'danger';
}

/** Terminal states. A rider cannot act on a finished job, so nothing is offered. */
const TERMINAL = new Set(['DELIVERED', 'COMPLETED', 'COLLECTED', 'CANCELLED', 'RETURNED']);

const PICKUP_ACTIONS: readonly JobAction[] = [
  {
    id: 'scan',
    label: 'Scan the parcels out',
    detail: 'Each scan queues on this device and syncs when signal returns.',
    icon: 'scan-outline',
    weight: 'primary',
    tone: 'brand',
  },
];

const DELIVERY_UNATTEMPTED: readonly JobAction[] = [
  {
    id: 'deliver',
    label: 'Capture proof of delivery',
    detail:
      'The customer reads out a code, you photograph the handover, and the location is recorded.',
    icon: 'camera-outline',
    weight: 'primary',
    tone: 'brand',
  },
  {
    id: 'fail',
    label: 'Customer not in — record a failed attempt',
    detail: 'The parcel goes back on the van, or on to returns.',
    icon: 'alert-circle-outline',
    weight: 'secondary',
    tone: 'danger',
  },
];

const DELIVERY_ATTEMPTED: readonly JobAction[] = [
  {
    id: 'fail',
    label: 'Record another failed attempt',
    detail: 'The parcel goes back on the van, or on to returns.',
    icon: 'alert-circle-outline',
    weight: 'primary',
    tone: 'danger',
  },
];

/**
 * The actions legal for `job` right now, primary first.
 *
 * A job whose status is outside the closed vocabulary returns `[]` rather than a guess, and the
 * caller then says the server will decide instead of showing buttons that may not work.
 */
export function actionsFor(job: JobRow): readonly JobAction[] {
  if (TERMINAL.has(job.status)) return [];

  if (job.kind === 'pickup') {
    // A pickup is a scan. There is no failure path at a shop door: the rider either takes the
    // parcels or does not, and taking them is the scan.
    return job.status === 'PICKED_UP' ? [] : PICKUP_ACTIONS;
  }

  if (job.status === 'OUT_FOR_DELIVERY' || job.status === 'ACCEPTED' || job.status === 'ASSIGNED') {
    return DELIVERY_UNATTEMPTED;
  }
  if (job.status === 'ATTEMPTED' || job.status === 'EXCEPTION') {
    return DELIVERY_ATTEMPTED;
  }
  return [];
}

/**
 * The single action to promote, or null when there is nothing legal to do.
 *
 * Exactly one action is ever primary. A screen with two primary actions is a screen the rider has to
 * think about, and thinking is what a one-handed phone in a doorway is worst at.
 */
export function primaryAction(job: JobRow): JobAction | null {
  return actionsFor(job).find((action) => action.weight === 'primary') ?? null;
}

/** The supporting actions, shown beneath the primary one. */
export function secondaryActions(job: JobRow): readonly JobAction[] {
  return actionsFor(job).filter((action) => action.weight === 'secondary');
}

/**
 * Whether a failed attempt is the last one before the parcel is handed to returns.
 *
 * The server decides. This exists so the rider can be told before they tap, because "this is the
 * third try" and "this is the first of three" are different decisions at a door.
 */
export function isFinalAttempt(attemptsMade: number): boolean {
  return attemptsMade >= 2;
}
