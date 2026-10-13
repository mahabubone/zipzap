/**
 * What a status **means**, in words a designer can paint.
 *
 * ## The distinction this file exists to make
 *
 * "Out for delivery" and "In transit" are both in motion, and on the web they were both `info` — which
 * is correct and unremarkable. On the rider's phone they were deliberately different, because one of
 * them means *you* are the next step and the other means the parcel is going to be somewhere else for
 * a while. That difference was real, and it was expressed as a special case in a `switch` that three
 * other copies of the switch did not have.
 *
 * So the shared decision is not a colour. It is a class of state, and each kit maps a class to its own
 * palette:
 *
 * | class        | meaning                                     | web kit | rider app     |
 * | ------------ | ------------------------------------------- | -------- | ------------- |
 * | `final`      | finished, nothing to do                      | success  | success       |
 * | `failed`     | something went wrong, permanently           | danger   | danger        |
 * | `attention`  | waiting on a person                          | warning  | warning       |
 * | `actionable` | **this device or this person is next**      | info     | brand         |
 * | `moving`     | in motion, not waiting on anybody            | info     | info          |
 * | `neutral`    | no state yet, or a state we do not know      | neutral  | neutral       |
 *
 * `actionable` is the one that earns the abstraction: the rider's app is the surface where "with you
 * now" is the single most important thing a status can say, and it is exactly what a colour cannot
 * express without a comment beside it explaining what the colour means.
 */

export type StatusState = 'final' | 'failed' | 'attention' | 'actionable' | 'moving' | 'neutral';

const BY_STATE: Readonly<Record<StatusState, readonly string[]>> = {
  // Finished. Nothing more happens without a new instruction.
  final: [
    'DELIVERED',
    'RETURNED',
    'COMPLETED',
    'SETTLED',
    'RECONCILED',
    'COD_COLLECTED',
    'AVAILABLE',
    'COLLECTED',
  ],
  // Permanently wrong. "Attempted" is not here — a failed attempt can be retried, so it waits.
  failed: ['CANCELLED', 'LOST', 'DAMAGED', 'DELIVERY_FAILED', 'FAILED', 'SUSPENDED'],
  // Waiting on somebody. Includes the offline queue's own states, which are pending on a decision.
  attention: [
    'ON_HOLD',
    'RETRY_SCHEDULED',
    'EXCEPTION',
    'RETURN_INITIATED',
    'ATTEMPTED',
    'QUEUED',
    'PENDING',
  ],
  // With the person who can act on it, right now.
  actionable: ['OUT_FOR_DELIVERY', 'ASSIGNED', 'PICKUP_ASSIGNED', 'PICKED_UP'],
  // In motion on its own.
  moving: [
    'IN_TRANSIT',
    'DISPATCHED',
    'AT_ORIGIN_HUB',
    'AT_DESTINATION_HUB',
    'SORTING',
    'ON_DELIVERY',
    'ON_PICKUP',
    'INBOUND',
    'OUTBOUND',
  ],
  // Not started, or a state added after this table was written.
  neutral: ['CREATED', 'DRAFT', 'REQUESTED', 'SEALED', 'RECEIVED'],
};

const STATE_OF: ReadonlyMap<string, StatusState> = new Map<string, StatusState>(
  (Object.entries(BY_STATE) as Array<[StatusState, readonly string[]]>).flatMap(
    ([state, statuses]) => statuses.map((status) => [status, state] as const),
  ),
);

/**
 * The class a status belongs to. Unknown statuses are `neutral`, deliberately: a new state must reach
 * a screen as unremarkable rather than alarming, because nobody has decided what it means yet and
 * painting it red on the strength of a guess is how a dashboard loses its credibility.
 */
export function statusState(status: string): StatusState {
  return STATE_OF.get(status) ?? 'neutral';
}

/** Every class, in the order a designer's palette is usually laid out. */
export const STATUS_STATES: readonly StatusState[] = [
  'final',
  'failed',
  'attention',
  'actionable',
  'moving',
  'neutral',
];

/** The statuses in a class, for a test that checks the table is the one we think it is. */
export function statusesIn(state: StatusState): readonly string[] {
  return BY_STATE[state];
}
