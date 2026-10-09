import { describe, expect, it } from 'vitest';
import {
  NO_FILTERS,
  dhakaDayEndExclusive,
  dhakaDayStart,
  escapeLike,
  parseShipmentFilters,
} from './filters.ts';

/** The filters a successful parse produced, or null when it failed. */
function ok(raw: Parameters<typeof parseShipmentFilters>[0]) {
  const parsed = parseShipmentFilters(raw);
  return parsed.ok ? parsed.filters : null;
}

function issues(raw: Parameters<typeof parseShipmentFilters>[0]) {
  const parsed = parseShipmentFilters(raw);
  return parsed.ok ? [] : parsed.issues;
}

describe('parseShipmentFilters', () => {
  it('treats an empty query as no filter at all', () => {
    expect(ok({})).toEqual(NO_FILTERS);
    expect(ok({ status: '', zone: '  ', q: '', from: '', to: '' })).toEqual(NO_FILTERS);
  });

  it('ignores params it does not implement rather than failing on them', () => {
    // Cast, not an inline `as never`: an object literal with an extra key fails
    // the excess-property check before the parser ever sees it, which would make
    // this test assert the compiler rather than the function.
    const withExtras = { q: 'ZP-1', sortBy: 'weight' } as Parameters<
      typeof parseShipmentFilters
    >[0];
    expect(ok(withExtras)).toMatchObject({ search: 'ZP-1' });
  });

  describe('status', () => {
    it('accepts every real status', () => {
      expect(ok({ status: 'DELIVERED' })?.statuses).toEqual(['DELIVERED']);
      expect(ok({ status: 'IN_TRANSIT' })?.statuses).toEqual(['IN_TRANSIT']);
    });

    it('accepts a merchant GROUP as a comma list', () => {
      expect(ok({ status: 'DISPATCHED,IN_TRANSIT,AT_DESTINATION_HUB' })?.statuses).toEqual([
        'DISPATCHED',
        'IN_TRANSIT',
        'AT_DESTINATION_HUB',
      ]);
    });

    it('collapses repeats and surrounding whitespace', () => {
      expect(ok({ status: ' LOST , LOST ,lost ' })?.statuses).toEqual(['LOST']);
    });

    it('upper-cases and trims, because a merchant types "delivered"', () => {
      expect(ok({ status: ' delivered ' })?.statuses).toEqual(['DELIVERED']);
    });

    it('names every offending value, so one round trip fixes them all', () => {
      expect(issues({ status: 'DELIVERD,NOPE' })).toEqual([
        { path: 'status', message: 'unknown status "DELIVERD", "NOPE"' },
      ]);
    });

    it('refuses the WHOLE group rather than the half it understood', () => {
      // A partial filter that silently drops statuses reads as "these are all of
      // them", which is the one thing a filter must never imply.
      expect(ok({ status: 'DELIVERED,NOPE' })).toBeNull();
    });

    it('refuses a SQL fragment outright', () => {
      expect(issues({ status: "CREATED') OR 1=1--" })[0]?.path).toBe('status');
      expect(ok({ status: "CREATED') OR 1=1--" })).toBeNull();
    });
  });

  describe('q', () => {
    it('trims and keeps the term as typed', () => {
      expect(ok({ q: '  ZP-9K2M ' })?.search).toBe('ZP-9K2M');
    });

    it('rejects a term long enough to be a scan', () => {
      expect(issues({ q: 'x'.repeat(81) })).toEqual([
        { path: 'q', message: 'search must be at most 80 characters' },
      ]);
    });
  });

  describe('zone', () => {
    it('is matched exactly, case preserved', () => {
      expect(ok({ zone: 'Dhaka-Metro' })?.zone).toBe('Dhaka-Metro');
    });

    it('caps the length', () => {
      expect(issues({ zone: 'z'.repeat(81) })[0]?.path).toBe('zone');
    });
  });

  describe('from and to', () => {
    it('accepts an ISO date', () => {
      expect(ok({ from: '2026-10-01' })?.from).toBe('2026-10-01');
      expect(ok({ to: '2026-10-09' })?.to).toBe('2026-10-09');
    });

    it('rejects a date that does not exist rather than rolling it over', () => {
      expect(issues({ from: '2026-02-31' })[0]?.path).toBe('from');
      expect(issues({ to: '2026-13-01' })[0]?.path).toBe('to');
    });

    it('rejects the shapes a date picker does not produce', () => {
      for (const bad of ['yesterday', '01-10-2026', '2026-10-01T00:00:00Z']) {
        expect(issues({ from: bad })[0]?.path).toBe('from');
      }
    });

    it('rejects a range that runs backwards', () => {
      expect(issues({ from: '2026-10-09', to: '2026-10-01' })).toEqual([
        { path: 'from', message: 'from must not be after to' },
      ]);
    });

    it('accepts a single-day range', () => {
      expect(ok({ from: '2026-10-01', to: '2026-10-01' })).toMatchObject({
        from: '2026-10-01',
        to: '2026-10-01',
      });
    });

    it('does not also complain about ordering when a bound is already invalid', () => {
      expect(issues({ from: 'nope', to: '2026-10-01' })).toHaveLength(1);
    });

    it('compares range bounds in Dhaka days, not as raw strings', () => {
      // Lexically '2026-10-1' > '2026-10-09' would be true and wrong. Parsed as
      // days, 1 October is after 9 October and the range is correctly refused.
      expect(issues({ from: '2026-10-11', to: '2026-10-09' })).toHaveLength(1);
      expect(ok({ from: '2026-10-09', to: '2026-10-11' })).not.toBeNull();
    });
  });

  describe('escapeLike', () => {
    it('neutralises a wildcard rather than letting it widen the search', () => {
      expect(escapeLike('100%')).toBe('100\\%');
    });

    it('neutralises the single-character wildcard', () => {
      expect(escapeLike('ZP_1')).toBe('ZP\\_1');
    });

    it('neutralises the escape character itself', () => {
      expect(escapeLike('a\\b')).toBe('a\\\\b');
    });

    it('leaves an ordinary term untouched', () => {
      expect(escapeLike('ZP-9K2M')).toBe('ZP-9K2M');
    });
  });

  it('reports every problem at once so a caller fixes one round trip', () => {
    expect(issues({ status: 'NOPE', q: 'x'.repeat(81), from: 'nope' })).toEqual([
      { path: 'status', message: 'unknown status "NOPE"' },
      { path: 'q', message: 'search must be at most 80 characters' },
      { path: 'from', message: 'from must be a yyyy-mm-dd date' },
    ]);
  });

  // The type is load-bearing, not a style choice: `pg` renders a number as bare
  // digits, so an epoch-millis return reached PostgreSQL as the text
  // '1759276800000' and every date filter was a 500 with DateTimeParseError.
  // An assertion on the value alone passes for both representations.
  describe('dhakaDayStart', () => {
    it('returns a Date, because that is what pg can hand to a timestamp column', () => {
      expect(dhakaDayStart('2026-10-01')).toBeInstanceOf(Date);
      expect(Number.isNaN(dhakaDayStart('2026-10-01').getTime())).toBe(false);
    });

    it('is midnight in Asia/Dhaka, which is 18:00 the previous day in UTC', () => {
      expect(dhakaDayStart('2026-10-01').toISOString()).toBe('2026-09-30T18:00:00.000Z');
    });

    it('is six hours before UTC midnight, so a bare UTC parse would be wrong', () => {
      expect(dhakaDayStart('2026-10-01').getTime() - Date.parse('2026-10-01T00:00:00Z')).toBe(
        -6 * 60 * 60 * 1000,
      );
    });

    it('keeps two adjacent days exactly one day apart, DST or not', () => {
      const day = dhakaDayStart('2026-03-29').getTime();
      const next = dhakaDayStart('2026-03-30').getTime();
      expect(next - day).toBe(24 * 60 * 60 * 1000);
    });
  });

  // `to` is inclusive of the whole selected day, which only an exclusive upper
  // bound can express. Getting this wrong does not error — it quietly drops the
  // last day, so the assertion has to be about the value, not just the type.
  describe('dhakaDayEndExclusive', () => {
    it('is midnight at the START of the next day, not the end of this one', () => {
      expect(dhakaDayEndExclusive('2026-10-01').toISOString()).toBe('2026-10-01T18:00:00.000Z');
    });

    it('returns a Date, for the same pg reason as dhakaDayStart', () => {
      expect(dhakaDayEndExclusive('2026-10-01')).toBeInstanceOf(Date);
      expect(Number.isNaN(dhakaDayEndExclusive('2026-10-01').getTime())).toBe(false);
    });

    it('is exactly one day after the same day start', () => {
      expect(
        dhakaDayEndExclusive('2026-10-01').getTime() - dhakaDayStart('2026-10-01').getTime(),
      ).toBe(24 * 60 * 60 * 1000);
    });

    it('excludes the first instant of the next day, so the bound really is exclusive', () => {
      // The last millisecond inside 2026-10-01 Dhaka must be below the bound,
      // and the first millisecond of 2026-10-02 Dhaka must be at or above it.
      expect(Date.parse('2026-10-01T17:59:59.999Z')).toBeLessThan(
        dhakaDayEndExclusive('2026-10-01').getTime(),
      );
      expect(dhakaDayEndExclusive('2026-10-01').getTime()).toBeLessThanOrEqual(
        Date.parse('2026-10-02T00:00:00+06:00'),
      );
    });
  });
});
