/**
 * The shift: when this rider started working, and what belongs to that shift.
 *
 * Pure, by AGENTS.md's rule 3 — no React Native, no Expo, no storage. Everything here is a plain
 * function over plain values, so the rule that decides whether a rider should be shown a parcel can be
 * tested without a phone or a browser, which is the same reason `command-queue.ts` is testable.
 *
 * **Why this exists at all.** Without it, "today's jobs" means "every job ever assigned to me". A rider
 * who opened the app mid-week would be handed Tuesday's parcels, and on a shared device — which is how
 * depots actually work — the previous rider's whole day is sitting there waiting to be scanned. The
 * shift is the boundary that makes the feed mean something.
 *
 * It is deliberately a **local** primitive, not a server concept. A rider's shift starts when they open
 * the app, not when a dispatcher says so, and a phone with no signal must be able to start a shift
 * because that is exactly when the rider needs one.
 */

/** One shift, as persisted. */
export interface Shift {
  /** When the shift started, as an ISO 8601 instant. */
  readonly startedAt: string;
  /** The rider this shift belongs to. A shift never crosses riders on a shared device. */
  readonly riderId: string;
}

/** A shift that is running, with its derived figures. Never persisted — derived on read. */
export interface ActiveShift {
  readonly startedAt: string;
  readonly riderId: string;
  /** Whole minutes since `startedAt`. Negative never happens: a clock jump backwards is clamped. */
  readonly minutesOnShift: number;
}

/** How old a job can be and still be part of the shift. */
const SHIFT_MAX_AGE_HOURS = 24;

function parseInstant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Whether a job assigned at `assignedAt` belongs to the shift that started at `startedAt`.
 *
 * The comparison is on **job assignment time**, not wall-clock time. A rider on a 14-hour shift at
 * hour 13 must still see a parcel assigned ten minutes ago, and must not see one assigned yesterday.
 * Comparing against `startedAt` makes both of those true; comparing against "today" makes neither.
 *
 * A clock jump backwards on the device is clamped to "in the shift" rather than answered with "no",
 * because refusing the job would lose the rider's work over a timezone bug.
 *
 * A job older than `SHIFT_MAX_AGE_HOURS` is excluded even if it is technically after the shift start:
 * a rider opening the app after a three-day gap must not be handed a week of stale parcels, and
 * "everything since you started" is not a useful definition of "today" when the app has been closed
 * for three days.
 */
export function isJobInShift(assignedAt: string, startedAt: string): boolean {
  const assigned = parseInstant(assignedAt);
  const started = parseInstant(startedAt);
  if (assigned === null || started === null) {
    // An undateable job cannot be shown to belong to a shift. Showing it is the smaller error: it
    // is a real parcel the rider was assigned, and hiding it loses work.
    return true;
  }
  if (assigned < started) return false;

  const ageMs = assigned - started;
  return ageMs <= SHIFT_MAX_AGE_HOURS * 60 * 60 * 1000;
}

/** Derive the display figures for a running shift. Pure, so the screen just renders. */
export function activeShift(shift: Shift, now: number = Date.now()): ActiveShift | null {
  const started = parseInstant(shift.startedAt);
  if (started === null) return null;
  return {
    startedAt: shift.startedAt,
    riderId: shift.riderId,
    // Clamped: a device clock that jumps backwards must not show "-12m on shift".
    minutesOnShift: Math.max(0, Math.floor((now - started) / 60_000)),
  };
}

/**
 * Start a shift, discarding any previous one.
 *
 * There is exactly one shift at a time and it belongs to exactly one rider. A rider signing in over
 * a previous rider's shift starts a new one rather than inheriting it, which is the whole point on a
 * shared depot device: the previous rider's parcels stop being this rider's parcels the moment the
 * session changes.
 */
export function startShift(riderId: string, now: number = Date.now()): Shift {
  return { startedAt: new Date(now).toISOString(), riderId };
}

/** Whether a stored shift still belongs to the rider who is signed in. */
export function shiftBelongsToRider(shift: Shift | null, riderId: string): boolean {
  return shift !== null && shift.riderId === riderId;
}

/** Format the on-shift duration the way a rider reads it. */
export function formatDuration(minutes: number): string {
  if (minutes < 1) return 'just started';
  if (minutes < 60) return `${minutes}m on shift`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours}h on shift`;
  return `${hours}h ${rest}m on shift`;
}
