/**
 * Rider lifecycle and deterministic assignment scoring. Framework-free.
 *
 * **This is not an optimal routing algorithm.** It is deterministic and explainable: the same
 * inputs always choose the same rider, and operations can read why. When a customer asks why a
 * parcel went the long way, the answer is in the scoring breakdown, not in a black box.
 *
 * Ties break on `rider_id`, never on iteration order. Non-deterministic assignment is
 * non-debuggable assignment — and a heisenbug in dispatch is the most expensive kind.
 */

export const RIDER_STATUSES = [
  'OFFLINE',
  'AVAILABLE',
  'ON_PICKUP',
  'ON_DELIVERY',
  'ON_BREAK',
  'SUSPENDED',
] as const;

export type RiderStatus = (typeof RIDER_STATUSES)[number];

export const RIDER_TRANSITIONS = {
  OFFLINE: ['AVAILABLE'],
  AVAILABLE: ['ON_PICKUP', 'ON_DELIVERY', 'ON_BREAK', 'OFFLINE', 'SUSPENDED'],
  ON_PICKUP: ['AVAILABLE', 'ON_BREAK', 'OFFLINE'],
  ON_DELIVERY: ['AVAILABLE', 'ON_BREAK', 'OFFLINE'],
  ON_BREAK: ['AVAILABLE', 'OFFLINE'],
  SUSPENDED: ['AVAILABLE'],
} as const satisfies Readonly<Record<RiderStatus, readonly RiderStatus[]>>;

export function canTransition(from: RiderStatus, to: RiderStatus): boolean {
  return (RIDER_TRANSITIONS[from] as readonly RiderStatus[]).includes(to);
}

/** Only an AVAILABLE rider may be scored. Eligibility is decided before scoring begins. */
export function isAssignable(status: RiderStatus): boolean {
  return status === 'AVAILABLE';
}

export interface AssignmentCandidate {
  readonly riderId: string;
  /** Metres from the rider's last known position to the job, or null when unknown. */
  readonly distanceMetres: number | null;
  /** Active jobs already held. */
  readonly activeJobs: number;
  /** Maximum concurrent jobs this rider may hold. */
  readonly capacity: number;
  /** Number of consecutive refusals, used against the candidate. */
  readonly recentRefusals: number;
}

export interface ScoredCandidate extends AssignmentCandidate {
  readonly score: number;
  readonly reasons: readonly string[];
}

const MAX_DISTANCE_METRES = 15_000;

/**
 * Score descending is better. The arithmetic is deliberately readable — no weights hidden in a
 * matrix. Each component explains itself in `reasons` so the dispatch decision is auditable.
 */
export function score(candidates: readonly AssignmentCandidate[]): ScoredCandidate[] {
  return candidates
    .filter((candidate) => candidate.activeJobs < candidate.capacity)
    .map((candidate) => {
      const reasons: string[] = [];
      let points = 0;

      if (candidate.distanceMetres === null) {
        // Unknown position is worse than far: we cannot promise an ETA.
        points -= 500;
        reasons.push('location unknown');
      } else if (candidate.distanceMetres > MAX_DISTANCE_METRES) {
        // Beyond the service radius. Still scored (so a remote job degrades instead of
        // failing) but heavily penalised.
        points -= 1000 + Math.floor(candidate.distanceMetres / 1000);
        reasons.push(`beyond service radius (${Math.round(candidate.distanceMetres / 1000)}km)`);
      } else {
        points -= Math.floor(candidate.distanceMetres / 500);
        reasons.push(`${Math.round(candidate.distanceMetres / 1000)}km away`);
      }

      points -= candidate.activeJobs * 50;
      if (candidate.activeJobs > 0) reasons.push(`${candidate.activeJobs} active job(s)`);

      points -= candidate.recentRefusals * 25;
      if (candidate.recentRefusals > 0)
        reasons.push(`${candidate.recentRefusals} recent refusal(s)`);

      return { ...candidate, score: points, reasons };
    })
    .sort(
      (a, b) => b.score - a.score || (a.riderId < b.riderId ? -1 : a.riderId > b.riderId ? 1 : 0),
    );
}

/**
 * The single ordered list a dispatcher reads: best candidate first, with reasons attached.
 * An empty list means nobody is eligible right now — the job waits, it is not forced onto an
 * ineligible rider.
 */
export function rank(candidates: readonly AssignmentCandidate[]): readonly ScoredCandidate[] {
  return score(candidates);
}
