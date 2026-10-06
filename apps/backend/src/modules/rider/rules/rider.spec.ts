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

  it('the same inputs assign the same rider 100 times (every input rotation)', () => {
    const pool = [
      rider({ riderId: 'r-1', distanceMetres: 3000, activeJobs: 1 }),
      rider({ riderId: 'r-2', distanceMetres: 1500, recentRefusals: 2 }),
      rider({ riderId: 'r-3', distanceMetres: 1500, recentRefusals: 2 }),
      rider({ riderId: 'r-4', distanceMetres: 7000 }),
    ];
    const winners = new Set<string>();
    for (let i = 0; i < 100; i++) {
      // Rotate the input — deterministic, no Math.random — so every run sees a
      // different iteration order. Same inputs must still pick the same rider.
      const rotated = [...pool.slice(i % pool.length), ...pool.slice(0, i % pool.length)];
      winners.add(rank(rotated)[0]!.riderId);
    }
    expect(winners.size, 'same winner across 100 input orderings').toBe(1);
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

  it('measures load factor correctly', () => {
    import('./rider.ts').then((m) => {
      expect(m.loadFactor(0, 3)).toBe(0);
      expect(m.loadFactor(1, 3)).toBeCloseTo(1 / 3, 2);
      expect(m.loadFactor(2, 3)).toBeCloseTo(2 / 3, 2);
      expect(m.loadFactor(3, 3)).toBe(1);
      expect(m.loadFactor(5, 3)).toBe(1); // clamped
    });
  });

  it('activeJobCount uses caller-supplied count or currentJobId', () => {
    import('./rider.ts').then((m) => {
      expect(m.activeJobCount(null, null)).toBe(0);
      expect(m.activeJobCount('job-1', null)).toBe(1);
      expect(m.activeJobCount(null, 3)).toBe(3);
      expect(m.activeJobCount('job-1', 2)).toBe(2); // override wins
    });
  });

  it('poolLoad aggregates utilisation', () => {
    import('./rider.ts').then((m) => {
      const empty = m.poolLoad([]);
      expect(empty).toEqual({
        totalCapacity: 0,
        inUseCapacity: 0,
        meanLoadFactor: 0,
        maxLoadFactor: 0,
        minLoadFactor: 0,
      });

      const pool = m.poolLoad([
        { activeJobs: 0, capacity: 3 },
        { activeJobs: 2, capacity: 3 },
        { activeJobs: 0, capacity: 2 },
      ]);
      expect(pool.totalCapacity).toBe(8);
      expect(pool.inUseCapacity).toBe(2);
      expect(pool.meanLoadFactor).toBeCloseTo(2 / 8, 4);
      expect(pool.maxLoadFactor).toBeCloseTo(2 / 3, 4);
      expect(pool.minLoadFactor).toBeCloseTo(0, 4);
    });
  });

  it('refusals beat spare capacity (load factor subordinate to refusals)', () => {
    const ranked = rank([
      rider({ riderId: 'r-refused', distanceMetres: 1000, recentRefusals: 5, activeJobs: 0 }), // -87: idle, -127 refusals
      rider({ riderId: 'r-remote', distanceMetres: 14000, activeJobs: 0 }), // +12: idle
    ]);
    // Both idle (identical spare bonus): refusals dominate — the refused rider ranks below.
    expect(ranked.map((c) => c.riderId)).toEqual(['r-remote', 'r-refused']);
  });

  it('load balancing spreads work: assigns to the lighter rider when loads differ', () => {
    const pool = [
      rider({ riderId: 'r-full', distanceMetres: 1000, activeJobs: 2, capacity: 3 }),
      rider({ riderId: 'r-spare', distanceMetres: 5000, activeJobs: 0, capacity: 3 }),
    ];
    // spare bonus: r-full +13, r-spare +40; distance penalty: r-full -2, r-spare -10
    const ranked = rank(pool);
    expect(ranked[0]!.riderId).toBe('r-spare');
  });

  it('load balancing improves the pool before/after assignment', () => {
    import('./rider.ts').then((m) => {
      // Before: three riders, two at 2/3 load, one idle.
      const pool = [
        { riderId: 'r-1', distanceMetres: 1000, activeJobs: 2, capacity: 3, recentRefusals: 0 },
        { riderId: 'r-2', distanceMetres: 1000, activeJobs: 2, capacity: 3, recentRefusals: 0 },
        { riderId: 'r-3', distanceMetres: 1000, activeJobs: 0, capacity: 3, recentRefusals: 0 },
      ] as const;
      const before = m.poolLoad(pool);
      expect(before.maxLoadFactor).toBeCloseTo(2 / 3, 4);

      // The load-optimised rank picks the idle rider r-3.
      const [chosen] = rank(pool);
      expect(chosen!.riderId).toBe('r-3');
      const after = m.poolLoad([
        { ...pool[0], activeJobs: pool[0].activeJobs },
        { ...pool[1], activeJobs: pool[1].activeJobs },
        { ...pool[2], activeJobs: 1, capacity: 3 },
      ]);
      expect(after.maxLoadFactor).toBeCloseTo(2 / 3, 4); // KPI held, not degraded

      // Alternative — assigning to a rider already at 2/3 — would overload them (max = 1).
      const alternative = m.poolLoad([
        { ...pool[0], activeJobs: 3, capacity: 3 },
        pool[1],
        pool[2],
      ]);
      expect(alternative.maxLoadFactor).toBe(1);
      expect(after.maxLoadFactor).toBeLessThan(alternative.maxLoadFactor); // recorded before/after proves the improvement
    });
  });

  it('determinism is preserved with the load term (no Math.random)', () => {
    const pool = [
      rider({ riderId: 'r-1', distanceMetres: 3000, activeJobs: 1 }),
      rider({ riderId: 'r-2', distanceMetres: 1500, recentRefusals: 2 }),
      rider({ riderId: 'r-3', distanceMetres: 1500, recentRefusals: 2, activeJobs: 1 }),
    ];
    expect(rank(pool).map((c) => c.riderId)).toEqual(
      rank([...pool].reverse()).map((c) => c.riderId),
    );
  });
});
