import { describe, expect, it } from 'vitest';
import { isAssignable, rank, type AssignmentCandidate } from './rider.ts';

const rider = (overrides: Partial<AssignmentCandidate> = {}): AssignmentCandidate => ({
  riderId: 'r-1',
  distanceMetres: 1000,
  activeJobs: 0,
  capacity: 3,
  recentRefusals: 0,
  ...overrides,
});

describe('rider assignment scoring', () => {
  it('only AVAILABLE riders are assignable', () => {
    expect(isAssignable('AVAILABLE')).toBe(true);
    for (const status of [
      'OFFLINE',
      'ON_PICKUP',
      'ON_DELIVERY',
      'ON_BREAK',
      'SUSPENDED',
    ] as const) {
      expect(isAssignable(status)).toBe(false);
    }
  });

  it('prefers the nearest eligible rider', () => {
    const ranked = rank([
      rider({ riderId: 'r-far', distanceMetres: 8000 }),
      rider({ riderId: 'r-near', distanceMetres: 1200 }),
    ]);
    expect(ranked[0]!.riderId).toBe('r-near');
  });

  it('excludes riders at capacity rather than overloading them', () => {
    const ranked = rank([rider({ riderId: 'r-full', activeJobs: 3, capacity: 3 })]);
    expect(ranked).toHaveLength(0);
  });

  it('breaks exact ties on rider_id, never on iteration order', () => {
    const a = rider({ riderId: 'r-b' });
    const b = rider({ riderId: 'r-a' });
    const forward = rank([a, b]).map((c) => c.riderId);
    const reversed = rank([b, a]).map((c) => c.riderId);
    expect(forward).toEqual(['r-a', 'r-b']);
    expect(reversed).toEqual(['r-a', 'r-b']);
  });

  it('penalises unknown location worse than far-but-known, and past refusals', () => {
    const ranked = rank([
      rider({ riderId: 'r-far', distanceMetres: 14_000 }),
      rider({ riderId: 'r-unknown', distanceMetres: null }),
      rider({ riderId: 'r-refuser', distanceMetres: 1000, recentRefusals: 5 }),
      rider({ riderId: 'r-best', distanceMetres: 2000 }),
    ]);
    // A close rider with 5 refusals ranks BELOW a far-but-known one: repeated refusal is a
    // stronger signal than distance inside the service radius. Unknown location is worst —
    // we cannot promise an ETA at all.
    expect(ranked.map((c) => c.riderId)).toEqual(['r-best', 'r-far', 'r-refuser', 'r-unknown']);
  });

  it('is deterministic across runs', () => {
    const pool = [
      rider({ riderId: 'r-1', distanceMetres: 3000, activeJobs: 1 }),
      rider({ riderId: 'r-2', distanceMetres: 1500, recentRefusals: 2 }),
      rider({ riderId: 'r-3', distanceMetres: null }),
    ];
    expect(rank(pool).map((c) => c.riderId)).toEqual(
      rank([...pool].reverse()).map((c) => c.riderId),
    );
  });

  it('returns an empty list when nobody is eligible — the job waits', () => {
    expect(rank([])).toEqual([]);
    expect(rank([rider({ activeJobs: 5, capacity: 3 })])).toEqual([]);
  });

  it('explains every decision in reasons', () => {
    const [best] = rank([rider({ riderId: 'r-1', distanceMetres: 1800, activeJobs: 1 })]);
    expect(best!.reasons.length).toBeGreaterThan(0);
    expect(typeof best!.score).toBe('number');
  });
});
