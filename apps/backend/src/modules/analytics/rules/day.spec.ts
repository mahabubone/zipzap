import { describe, expect, it } from 'vitest';
import { dayKey } from './day';

describe('dayKey', () => {
  it('buckets instants by the Asia/Dhaka calendar date, not UTC', () => {
    // 18:30 UTC = 00:30 next day in Dhaka (UTC+6).
    expect(dayKey(new Date('2026-01-01T18:30:00Z'))).toBe('2026-01-02');
    // 17:59 UTC is still 23:59 on the same Dhaka day.
    expect(dayKey(new Date('2026-01-01T17:59:00Z'))).toBe('2026-01-01');
    // Pure UTC midnight is already past midnight in Dhaka.
    expect(dayKey(new Date('2026-06-15T00:00:00Z'))).toBe('2026-06-15');
  });

  it('returns a zero-padded iso date', () => {
    expect(dayKey(new Date('2026-03-05T12:00:00Z'))).toBe('2026-03-05');
    expect(dayKey(new Date('2026-11-09T12:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
