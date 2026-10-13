/**
 * Merchant-facing status groups for the list filter.
 *
 * The state machine has 24 statuses. Putting 24 of them in a dropdown would be
 * a state machine diagram wearing a select box: a merchant does not think "is
 * this AT_DESTINATION_HUB or SORTING", they think "is it moving". So the filter
 * offers the groups below and sends the underlying statuses as a comma list.
 *
 * The drift risk is the whole reason this file has a check: a new status added
 * to the backend state machine lands in NONE of these groups, and the console
 * then quietly stops offering a filter for it. `scripts/verify-status-groups.mjs`
 * reads the backend's own SHIPMENT_STATUSES and fails if any status is neither
 * grouped nor explicitly hidden.
 */

export interface StatusGroup {
  /** The `status` query value: a comma-separated list, or '' for no filter. */
  readonly value: string;
  readonly label: string;
}

export const STATUS_GROUPS: ReadonlyArray<StatusGroup> = [
  { value: '', label: 'All statuses' },
  {
    value: 'CREATED,PICKUP_REQUESTED,PICKUP_ASSIGNED,PICKED_UP',
    label: 'Awaiting pickup',
  },
  {
    value: 'AT_ORIGIN_HUB,SORTING,DISPATCHED,IN_TRANSIT,AT_DESTINATION_HUB',
    label: 'In transit',
  },
  { value: 'OUT_FOR_DELIVERY,RETURN_OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { value: 'DELIVERED', label: 'Delivered' },
  {
    value: 'DELIVERY_FAILED,RETRY_SCHEDULED,ON_HOLD,LOST,DAMAGED,EXCEPTION',
    label: 'Needs attention',
  },
  { value: 'RETURN_INITIATED,RETURN_IN_TRANSIT,RETURN_AT_HUB,RETURNED', label: 'Returning' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/**
 * States a merchant never sees in their own list, so they get no filter.
 *
 * DRAFT is the initial state of the aggregate and is never persisted — a
 * shipment is inserted already CREATED. It is listed here rather than left
 * unmentioned so that the coverage check can tell "deliberately hidden" apart
 * from "somebody forgot", which are the same symptom and opposite meanings.
 */
export const HIDDEN_STATUSES: ReadonlyArray<string> = ['DRAFT'];

/** The statuses a group value expands to. `''` means no filter. */
export function statusesOf(value: string): readonly string[] {
  return value === ''
    ? []
    : value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
}
