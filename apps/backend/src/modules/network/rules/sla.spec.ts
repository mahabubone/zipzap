import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  estimateDelivery,
  isWorkDay,
  isHoliday,
  nextWorkDay,
  floorDhakaDate,
  dateKey,
  type Holiday,
  type ZoneCutoffs,
} from './sla.js';

const HOLIDAYS: readonly Holiday[] = [
  { date: '2026-10-07', reason: 'Eid observation' },
  { date: '2026-10-16', reason: 'Eid-ul-Adha observation' },
];

const CUTOFFS: ZoneCutoffs = {
  zone: 'dhaka-metro',
  pickupCutoff: '18:00',
  deliveryCutoff: '20:00',
};
const GLOBAL_CUTOFFS: ZoneCutoffs = {
  zone: 'dhaka-metro',
  pickupCutoff: null,
  deliveryCutoff: null,
};

// A `Date` built in UTC that represents the given Asia/Dhaka wall clock time
// (Dhaka is UTC+6).
function dhaka(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, m - 1, d, hh - 6, mm));
}

describe('sla', () => {
  it('floorDhakaDate normalizes to midnight in Asia/Dhaka', () => {
    const d = floorDhakaDate(dhaka(2026, 10, 5, 14, 30));
    assert.equal(d.getUTCFullYear(), 2026);
    assert.equal(d.getUTCMonth(), 9);
    assert.equal(d.getUTCDate(), 5);
    assert.equal(d.getUTCHours(), 0);
    assert.equal(d.getUTCMinutes(), 0);
  });

  it('dateKey produces the Dhaka yyyy-mm-dd', () => {
    assert.equal(dateKey(dhaka(2026, 10, 5, 4, 0)), '2026-10-05');
  });

  it('isWorkDay: Mon-Thu and Sunday are workdays (Bangladesh week)', () => {
    assert(isWorkDay(dhaka(2026, 10, 5, 10, 0), HOLIDAYS)); // Mon
    assert(isWorkDay(dhaka(2026, 10, 6, 10, 0), HOLIDAYS)); // Tue
    assert(isWorkDay(dhaka(2026, 10, 8, 10, 0), HOLIDAYS)); // Thu
    assert(isWorkDay(dhaka(2026, 10, 11, 10, 0), HOLIDAYS)); // Sun
    assert(!isWorkDay(dhaka(2026, 10, 9, 10, 0), HOLIDAYS)); // Fri
    assert(!isWorkDay(dhaka(2026, 10, 10, 10, 0), HOLIDAYS)); // Sat
  });

  it('a holiday overrides the workday', () => {
    assert(!isWorkDay(dhaka(2026, 10, 7, 10, 0), HOLIDAYS)); // Wed is a holiday
  });

  it('isHoliday matches by Dhaka date, not UTC', () => {
    assert(isHoliday(dhaka(2026, 10, 7, 10, 0), HOLIDAYS));
    assert(!isHoliday(dhaka(2026, 10, 8, 10, 0), HOLIDAYS));
  });

  it('nextWorkDay skips non-workdays', () => {
    assert.equal(dateKey(nextWorkDay(dhaka(2026, 10, 10, 10, 0), HOLIDAYS)), '2026-10-11'); // Sat -> Sun
    assert.equal(dateKey(nextWorkDay(dhaka(2026, 10, 9, 10, 0), HOLIDAYS)), '2026-10-11'); // Fri -> Sun
    assert.equal(dateKey(nextWorkDay(dhaka(2026, 10, 11, 10, 0), HOLIDAYS)), '2026-10-11'); // Sun stays
  });

  it('nextWorkDay skips holidays', () => {
    assert.equal(dateKey(nextWorkDay(dhaka(2026, 10, 7, 10, 0), HOLIDAYS)), '2026-10-08'); // Wed holiday -> Thu
  });

  it('estimateDelivery: no shift, before pickup cutoff', () => {
    // Mon 10:00 < 18:00 -> dispatch Mon; +1 business day -> Tue
    const result = estimateDelivery(dhaka(2026, 10, 5, 10, 0), 1, HOLIDAYS, CUTOFFS);
    assert.equal(dateKey(result.estimatedDate), '2026-10-06');
    assert.equal(result.pickupShifted, false);
    assert.equal(result.skippedHolidays.length, 0);
  });

  it('estimateDelivery: past pickup cutoff slides dispatch', () => {
    // Mon 19:00 > 18:00 -> dispatch shifts to Tue; Wed 10-07 is a holiday -> dispatch Thu;
    // +1 business day -> nextWorkDay(Fri 10-09) = Sun 10-11 ...
    // recompute: dispatch = nextWorkDay(Tue 10-06) = Tue 10-06. Count 1: nextBusinessDay(Tue)
    // = nextWorkDay(Wed 10-07) = Thu 10-08. estimated = Thu 10-08, holiday skipped.
    const result = estimateDelivery(dhaka(2026, 10, 5, 19, 0), 1, HOLIDAYS, CUTOFFS);
    assert.equal(dateKey(result.estimatedDate), '2026-10-08');
    assert.equal(result.pickupShifted, true);
    assert.equal(result.skippedHolidays[0], 'Eid observation');
  });

  it('estimateDelivery: holiday shifts the dispatch date itself', () => {
    // Tue 19:00 past cutoff -> dispatch nextWorkDay(Wed 10-07) = Thu 10-08;
    // +1 -> nextBusinessDay(Thu 10-08) = nextWorkDay(Fri 10-09) = Sun 10-11
    const result = estimateDelivery(dhaka(2026, 10, 6, 19, 0), 1, HOLIDAYS, CUTOFFS);
    assert.equal(dateKey(result.estimatedDate), '2026-10-11');
    assert.equal(result.pickupShifted, true);
    assert.equal(result.skippedHolidays[0], 'Eid observation');
  });

  it('estimateDelivery: weekend skip', () => {
    // Sat 10:00 -> dispatch nextWorkDay(Sat 10-10) = Sun 10-11;
    // +1 -> nextBusinessDay(Sun 10-11) = nextWorkDay(Mon 10-12) = Mon 10-12
    const result = estimateDelivery(dhaka(2026, 10, 10, 10, 0), 1, HOLIDAYS, CUTOFFS);
    assert.equal(dateKey(result.estimatedDate), '2026-10-12');
    assert.equal(result.pickupShifted, true);
  });

  it('estimateDelivery: estimatedDays=0 before delivery cutoff, same day', () => {
    // Tue 10:00 + 0 -> Tue, no shift
    const result = estimateDelivery(dhaka(2026, 10, 6, 10, 0), 0, HOLIDAYS, CUTOFFS);
    assert.equal(dateKey(result.estimatedDate), '2026-10-06');
    assert.equal(result.pickupShifted, false);
  });

  it('estimateDelivery: estimatedDays=0 past delivery cutoff', () => {
    // Tue 21:00 > 20:00 -> dispatch nextWorkDay(Wed 10-07) = Thu 10-08; +0 -> Thu
    const result = estimateDelivery(dhaka(2026, 10, 6, 21, 0), 0, HOLIDAYS, CUTOFFS);
    assert.equal(dateKey(result.estimatedDate), '2026-10-08');
    assert.equal(result.pickupShifted, true);
  });

  it('estimateDelivery: global default cutoffs when no zone row exists', () => {
    // Mon 19:00 with global default 18:00 pickup -> shifted
    const result = estimateDelivery(dhaka(2026, 10, 5, 19, 0), 1, HOLIDAYS, GLOBAL_CUTOFFS);
    assert.equal(result.pickupShifted, true);
  });

  it('estimateDelivery: negative estimatedDays rejects', () => {
    assert.throws(
      () => estimateDelivery(dhaka(2026, 10, 5, 10, 0), -1, HOLIDAYS, CUTOFFS),
      /non-negative/,
    );
  });
});
