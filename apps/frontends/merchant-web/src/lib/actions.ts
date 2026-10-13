/**
 * Which actions a merchant may take on a shipment, derived from the state machine.
 *
 * The backend refuses an illegal transition with INVALID_TRANSITION, so this is not a
 * security control — it is a screen that does not offer a button which is guaranteed to
 * fail. The rules are transcribed from TRANSITIONS in
 * apps/backend/src/modules/shipment/rules/state-machine.ts, which is the authority.
 *
 * `ponytail:` these are a copy, not a shared import. The backend file is plain TypeScript
 * under `rules/`, so it *could* be imported — but a web app importing server source across a
 * package boundary couples the two builds for the sake of a status list. If the vocabulary
 * ever gains a state, this file is the one to update, and verify-actions.mjs fails when the
 * two disagree.
 */

/** Statuses a merchant can act on. Mirrors the backend vocabulary. */
export type Status = string;

export interface ActionAvailability {
  readonly canHold: boolean;
  readonly canRelease: boolean;
  readonly canCancel: boolean;
  readonly canReportException: boolean;
  /** Only IN_TRANSIT can be LOST; DAMAGED is also found at SORTING. */
  readonly canReportLost: boolean;
  readonly canReportDamaged: boolean;
}

/** From TRANSITIONS: `ON_HOLD` is entered only from these three states. */
const HOLDABLE: ReadonlySet<string> = new Set([
  'OUT_FOR_DELIVERY',
  'DELIVERY_FAILED',
  'RETRY_SCHEDULED',
]);

/** From TRANSITIONS: `CANCELLED` is reachable only before the parcel is moving. */
const CANCELLABLE: ReadonlySet<string> = new Set([
  'DRAFT',
  'CREATED',
  'PICKUP_REQUESTED',
  'PICKUP_ASSIGNED',
]);

/** From TRANSITIONS: `EXCEPTION` is reachable while a parcel is in the network. */
const EXCEPTIONABLE: ReadonlySet<string> = new Set([
  'PICKED_UP',
  'AT_ORIGIN_HUB',
  'SORTING',
  'DISPATCHED',
  'IN_TRANSIT',
  'AT_DESTINATION_HUB',
]);

export function actionsFor(status: Status): ActionAvailability {
  return {
    canHold: HOLDABLE.has(status),
    // Release is only ever from ON_HOLD, and the backend resumes to the recorded state.
    canRelease: status === 'ON_HOLD',
    canCancel: CANCELLABLE.has(status),
    canReportException: EXCEPTIONABLE.has(status),
    // LOST is IN_TRANSIT-only: nothing is lost while still in the building.
    canReportLost: status === 'IN_TRANSIT',
    // Damage is found at hub sort or out in the network — the two physical places.
    canReportDamaged: status === 'SORTING' || status === 'IN_TRANSIT',
  };
}

export function anyActionAvailable(a: ActionAvailability): boolean {
  return (
    a.canHold ||
    a.canRelease ||
    a.canCancel ||
    a.canReportException ||
    a.canReportLost ||
    a.canReportDamaged
  );
}
