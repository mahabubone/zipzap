import { describe, expect, it } from 'vitest';
import { formatClock, formatWhen } from './format.ts';

/**
 * The only two decisions this package still owns, and the reason it exists at all.
 *
 * Timezone-aware formatting needs `Intl`, and Hermes' `Intl` is partial — so this stays in the web kit
 * while the words and the arithmetic went to `@zipzap/lexicon`. These tests are here because the
 * pinned zone is the decision: a screenshot taken on a machine in UTC+0 and one in UTC+7 must show the
 * same clock, or the gallery lies to whoever compares them.
 */

describe('formatWhen', () => {
  it('renders in Dhaka regardless of the machine it runs on', () => {
    // 16:39 UTC is 22:39 in Dhaka (+6). If this ever comes out as 16:39 the zone was dropped.
    expect(formatWhen('2026-10-07T16:39:47.960Z')).toBe('7 Oct 2026, 22:39');
  });

  it('is a full date and a minute, because a work list needs both', () => {
    expect(formatWhen('2026-12-31T18:05:00.000Z')).toBe('1 Jan 2027, 00:05');
  });
});

describe('formatClock', () => {
  it('renders the hour and minute in Dhaka', () => {
    expect(formatClock('2026-10-07T16:39:47.960Z')).toBe('22:39');
  });

  it('rolls the date over in the network timezone, not the machine one', () => {
    expect(formatClock('2026-12-31T18:05:00.000Z')).toBe('00:05');
  });
});
