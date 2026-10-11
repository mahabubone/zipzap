/**
 * The shift, and what belongs to it.
 *
 * The rule these tests protect is the one that makes the app usable on a shared device: without it,
 * "today's jobs" means "every job ever assigned to this rider", and a rider opening the app mid-week
 * is handed Tuesday's parcels. Two of these assertions exist specifically to catch that.
 */

import { describe, expect, it } from 'vitest';
import {
  activeShift,
  formatDuration,
  isJobInShift,
  shiftBelongsToRider,
  startShift,
  type Shift,
} from './shift.ts';

const T0 = Date.parse('2026-10-11T08:00:00.000Z');

function hoursBefore(hours: number): string {
  return new Date(T0 - hours * 3_600_000).toISOString();
}

function minutesBefore(minutes: number): string {
  return new Date(T0 - minutes * 60_000).toISOString();
}

function withinShift(startedAt: string) {
  return {
    /** A job assigned at `offsetMinutes` after the shift started. */
    at: (offsetMinutes: number) =>
      new Date(Date.parse(startedAt) + offsetMinutes * 60_000).toISOString(),
  };
}

describe('isJobInShift', () => {
  const shiftStart = '2026-10-11T08:00:00.000Z';
  const jobAt = withinShift(shiftStart);

  it('includes a job assigned after the shift started', () => {
    expect(isJobInShift(jobAt.at(30), shiftStart)).toBe(true);
  });

  it('excludes a job assigned before the shift started', () => {
    // The shared-device case: the previous rider's parcel is not this rider's parcel.
    expect(isJobInShift(hoursBefore(1), shiftStart)).toBe(false);
  });

  it('includes a job assigned during a long shift, not just "today"', () => {
    // The failure mode of comparing against wall-clock "today": a 14-hour shift at hour 13 still
    // receives parcels, and they must appear.
    expect(isJobInShift(new Date(T0 + 14 * 3_600_000).toISOString(), shiftStart)).toBe(true);
  });

  it('excludes a job older than the shift max age', () => {
    // A rider opening the app after a three-day gap must not be handed a week of stale parcels.
    expect(isJobInShift(hoursBefore(48), shiftStart)).toBe(false);
  });

  it('clamps a backwards clock jump rather than hiding the job', () => {
    // A device clock that jumps back would otherwise answer "not in shift" and lose the rider's work
    // over a timezone bug.
    const future = new Date(T0 + 10 * 60_000).toISOString();
    expect(isJobInShift(future, future)).toBe(true);
  });

  it('shows an undateable job rather than hiding it', () => {
    // A real parcel the rider was assigned is worth showing even with no parseable timestamp.
    expect(isJobInShift('not-a-date', shiftStart)).toBe(true);
  });

  it('treats the exact shift-start instant as inside', () => {
    expect(isJobInShift(shiftStart, shiftStart)).toBe(true);
  });
});

describe('startShift', () => {
  it('discards any previous shift rather than inheriting it', () => {
    // Different `now` values: the assertion is that the stored start moves, not that a clock
    // advanced — two shifts started at the same instant would legitimately share a timestamp.
    const first = startShift('rider-7', T0);
    const second = startShift('rider-9', T0 + 60_000);

    expect(second.startedAt).not.toBe(first.startedAt);
    expect(second.riderId).toBe('rider-9');
  });

  it('produces a parseable ISO instant', () => {
    const shift = startShift('rider-7', T0);
    expect(Date.parse(shift.startedAt)).toBe(T0);
  });
});

describe('activeShift', () => {
  it('derives the minutes on shift', () => {
    const shift: Shift = { startedAt: minutesBefore(45), riderId: 'rider-7' };
    const active = activeShift(shift, T0);

    expect(active?.minutesOnShift).toBe(45);
    expect(active?.riderId).toBe('rider-7');
  });

  it('clamps a backwards clock jump to zero', () => {
    const shift: Shift = { startedAt: new Date(T0 + 60_000).toISOString(), riderId: 'rider-7' };
    expect(activeShift(shift, T0)?.minutesOnShift).toBe(0);
  });

  it('returns null for an unparseable start', () => {
    const shift: Shift = { startedAt: 'whenever', riderId: 'rider-7' };
    expect(activeShift(shift, T0)).toBeNull();
  });
});

describe('shiftBelongsToRider', () => {
  it('is false for another rider shift, so a shared device never inherits one', () => {
    expect(
      shiftBelongsToRider({ startedAt: minutesBefore(30), riderId: 'rider-7' }, 'rider-9'),
    ).toBe(false);
  });

  it('is true for the signed-in rider', () => {
    expect(
      shiftBelongsToRider({ startedAt: minutesBefore(30), riderId: 'rider-7' }, 'rider-7'),
    ).toBe(true);
  });

  it('is false when there is no shift at all', () => {
    expect(shiftBelongsToRider(null, 'rider-7')).toBe(false);
  });
});

describe('formatDuration', () => {
  it('reads as minutes under an hour', () => {
    expect(formatDuration(45)).toBe('45m on shift');
  });

  it('reads as hours when minutes run out', () => {
    expect(formatDuration(120)).toBe('2h on shift');
  });

  it('keeps the remainder', () => {
    expect(formatDuration(135)).toBe('2h 15m on shift');
  });

  it('does not say "0m"', () => {
    expect(formatDuration(0)).toBe('just started');
  });
});
