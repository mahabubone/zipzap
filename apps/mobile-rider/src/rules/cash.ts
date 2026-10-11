/**
 * Cash in hand, and the carry limit that goes with it.
 *
 * Pure, by AGENTS.md's rule 3. The number this produces is an accounting of what the rider is
 * physically carrying, computed from what *this device* has queued and what the server has ruled on.
 *
 * **Why it is derived from the device and not the server.** The server knows every COD collection
 * ever made by every rider, but it has no endpoint that tells a rider what they are carrying, and
 * inventing one is R7's work. What the device knows is narrower and *true*: every collection this
 * device has recorded, and the ruling the server gave on each. A rider holding cash from a shift they
 * worked on a different phone is not carrying it on this one, and showing them a number that includes
 * it would be a lie that costs them a trip to the depot.
 *
 * That is also the honest version of the carry limit: the limit exists to stop one person carrying
 * too much, and the person is the one holding the phone.
 */

/** What the queue already knows, restated here so the rule does not depend on it. */
export interface CashCommand {
  readonly deviceSequence: number;
  readonly commandType: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** A server ruling, restated the same way. */
export interface CashRuling {
  readonly deviceSequence: number;
  readonly kind: 'applied' | 'rejected' | 'duplicate';
}

/** What the rider is carrying, as the screen shows it. */
export interface CashInHand {
  /** Sum of collections this device recorded and the server applied. Poisha, integer. */
  readonly outstandingMinor: number;
  /** Collections still queued, not yet ruled on. Poisha, integer. */
  readonly unconfirmedMinor: number;
  /** Both of the above. What the rider has physically taken from customers today. */
  readonly collectedMinor: number;
  /**
   * True once the rider is carrying enough that they should be told — before they collect more, not
   * after. A limit the rider learns about from a refusal is a limit that costs them a wasted trip.
   */
  readonly shouldWarn: boolean;
  /** True past the point where collecting more is the problem rather than the warning. */
  readonly shouldBlock: boolean;
}

/**
 * The command types a cash collection can arrive as.
 *
 * Both, because the queue already carries both: `recordDelivery` queues a
 * `zipzap.rider.delivery` carrying `collectedMinor`, and that is the same shape a whole delivery
 * produces. Reading only a dedicated `cod.collected` type would silently ignore every
 * collection the rider actually made, and the number would read `৳0` on a phone holding cash — the
 * one failure mode a cash display cannot have.
 */
const COD_COMMAND_TYPES: ReadonlySet<string> = new Set([
  'zipzap.rider.cod.collected',
  'zipzap.rider.delivery',
]);

/**
 * The carry limit, in poisha (৳50,000).
 *
 * A policy choice, not a derived one. It is deliberately in the rules file rather than the screen so
 * that changing it is a reviewable change to one number rather than a hunt through JSX, and so a test
 * can assert the boundary the screen promises. `৳50,000` is what a rider on a van carries before the
 * loss from a robbery stops being a rounding error.
 */
export const CASH_LIMIT_MINOR = 5_000_000;

/** Warn at 80%, matching `OfflineQueue`'s warn-at-90% shape: a warning that never fires is no warning. */
const WARN_AT_RATIO = 0.8;

function readMinor(payload: Readonly<Record<string, unknown>>): number {
  const value = payload['collectedMinor'];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return 0;
  return value;
}

function isCodCommand(command: CashCommand): boolean {
  return COD_COMMAND_TYPES.has(command.commandType);
}

/** Sequences the server applied, or ruled duplicate (already banked earlier). */
function settledSequences(rulings: readonly CashRuling[]): Set<number> {
  const settled = new Set<number>();
  for (const ruling of rulings) {
    if (ruling.kind === 'applied' || ruling.kind === 'duplicate')
      settled.add(ruling.deviceSequence);
  }
  return settled;
}

/**
 * What the rider is carrying, from what this device has done.
 *
 * `outstanding` counts applied, `unconfirmed` counts everything still sitting on the queue, and
 * `collected` is both.
 *
 * **A rejected collection still counts, as unconfirmed.** The rider physically took that money; the
 * server refused the *command* — a state mismatch, a cancelled parcel — not the cash in the rider's
 * hand. Subtracting it would tell a rider holding ৳1,250 that they are carrying nothing, and the
 * carry limit exists precisely to stop one person carrying too much. A number that undercounts what
 * is in a pocket is worse than no number, so the only safe default for "did the rider get this money"
 * is yes until proven otherwise.
 *
 * A duplicate is `outstanding` rather than unconfirmed, because the server banked it once already and
 * the rider really did take it — it is confirmed cash from a repeated message.
 *
 * A command that carries no money at all (a pickup scan) contributes nothing, which is why the
 * command type is checked rather than assuming every delivery queue is a collection.
 */
export function computeCashInHand(
  pending: readonly CashCommand[],
  rulings: readonly CashRuling[],
  limitMinor: number = CASH_LIMIT_MINOR,
): CashInHand {
  const settled = settledSequences(rulings);

  let outstandingMinor = 0;
  let unconfirmedMinor = 0;

  for (const command of pending) {
    if (!isCodCommand(command)) continue;
    const minor = readMinor(command.payload);

    // A settled ruling means the server ruled on it, so it is no longer queued even if the queue
    // still holds the row: the device clears settled rows out of `pending` as it replays, but a
    // command that was ruled on and not yet cleared must not be double-counted.
    if (settled.has(command.deviceSequence)) {
      outstandingMinor += minor;
      continue;
    }
    unconfirmedMinor += minor;
  }

  const collectedMinor = outstandingMinor + unconfirmedMinor;
  const warnAt = Math.floor(limitMinor * WARN_AT_RATIO);

  return {
    outstandingMinor,
    unconfirmedMinor,
    collectedMinor,
    shouldWarn: collectedMinor >= warnAt,
    shouldBlock: collectedMinor >= limitMinor,
  };
}

/** Format poisha the way a rider reads it: ৳237.50, two places, never a float. */
export function formatCash(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const absolute = Math.abs(minor);
  const major = Math.floor(absolute / 100);
  const rest = absolute % 100;
  return `${sign}৳${major.toLocaleString('en-US')}.${String(rest).padStart(2, '0')}`;
}
