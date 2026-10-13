import { describe, expect, it } from 'vitest';
import { humanStatus, scanAction, statusLabel, zoneLabel } from './labels.ts';
import { statusState, statusesIn, type StatusState } from './state.ts';
import { formatMinor, minorOf, splitMinor } from './money.ts';
import { formatAge } from './age.ts';

/**
 * These assertions are about the product's decisions, not about the code.
 *
 * Every one of them is a question that had two answers in this repository before the package existed:
 * "is this status a failure or a wait?", "what does 125050 look like on a phone?", "is it 4m or
 * 4 min?". A test inside each consuming app would have kept passing while the answers drifted apart,
 * because each copy was internally correct. A test here cannot.
 */

describe('statusLabel', () => {
  it('words a status rather than echoing the enum', () => {
    expect(statusLabel('IN_TRANSIT')).toBe('In transit');
    expect(statusLabel('OUT_FOR_DELIVERY')).toBe('Out for delivery');
    expect(statusLabel('AT_DESTINATION_HUB')).toBe('At destination hub');
  });

  it('says "Rider assigned", not "Pickup assigned"', () => {
    // The console's customer is a rider; "pickup assigned" describes the leg, not the person.
    expect(statusLabel('PICKUP_ASSIGNED')).toBe('Rider assigned');
  });

  it('falls back to words for a state nobody has named yet', () => {
    // A status added on the backend must reach a human on the day it ships. `SOMETHING_NEW` on a
    // screen is what the rider app was doing with `status.replace(/_/g, ' ')`, on every screen, for
    // every status it did not have a case for.
    expect(statusLabel('SOMETHING_NEW')).toBe('Something new');
    expect(statusLabel('SOMETHING_NEW')).not.toBe('SOMETHING_NEW');
  });

  it('never shouts a mid-word capital', () => {
    expect(statusLabel('OUT_FOR_DELIVERY')).not.toMatch(/For Delivery/);
  });

  it('covers a manifest state, because manifests and shipments share a screen', () => {
    expect(statusLabel('RECONCILED')).toBe('Reconciled');
  });
});

describe('humanStatus', () => {
  it('is the fallback, not a second vocabulary', () => {
    expect(humanStatus('ON_DELIVERY')).toBe('On delivery');
    expect(humanStatus('QUEUE')).toBe('Queue');
  });

  it('handles a status with no underscores at all', () => {
    expect(humanStatus('DELIVERED')).toBe('Delivered');
  });
});

describe('scanAction', () => {
  it('names the gesture, because the button is the gesture', () => {
    expect(scanAction('INBOUND')).toBe('Scan inbound');
    expect(scanAction('DEPARTED')).toBe('Scan departed');
  });

  it('does not narrate a gesture the server cannot perform', () => {
    // "Scan teleported" invites an operator to try something that does not exist, which is worse than
    // a button whose label is merely short.
    expect(scanAction('TELEPORTED')).toBe('Scan');
  });
});

describe('statusState', () => {
  it('separates "with you now" from "in motion" — the distinction the rider app needs', () => {
    // This is the whole reason the package exists rather than a shared tone map. On the rider's phone
    // the two are the most important distinction on the screen; on the web they are both `info`, and
    // both should be.
    expect(statusState('OUT_FOR_DELIVERY')).toBe('actionable');
    expect(statusState('ASSIGNED')).toBe('actionable');
    expect(statusState('IN_TRANSIT')).toBe('moving');
  });

  it('keeps a permanent failure apart from a retryable one', () => {
    // A failed *attempt* is waiting on somebody; a *lost* parcel is not. Painting both red trains a
    // rider to ignore red.
    expect(statusState('ATTEMPTED')).toBe('attention');
    expect(statusState('LOST')).toBe('failed');
    expect(statusState('DELIVERY_FAILED')).toBe('failed');
  });

  it('treats an unknown status as unremarkable rather than alarming', () => {
    // Nobody has decided what a new state means. Painting it red on the strength of a guess is how a
    // dashboard stops being read.
    expect(statusState('SOMETHING_NEW')).toBe('neutral');
    expect(statusState('CREATED')).toBe('neutral');
  });

  it('classifies every status the three machines between them used to', () => {
    // The rider's dead `STATUS_TONE`, its two divergent `statusTone` switches and the hub console's
    // copy covered this union between them, and disagreed on more than one entry. One table now, and
    // this is the union written out, so a status dropped from any of them shows up here.
    const expected: ReadonlyArray<readonly [string, StatusState]> = [
      ['DELIVERED', 'final'],
      ['COMPLETED', 'final'],
      ['COLLECTED', 'final'],
      ['SETTLED', 'final'],
      ['CANCELLED', 'failed'],
      ['FAILED', 'failed'],
      ['ATTEMPTED', 'attention'],
      ['EXCEPTION', 'attention'],
      ['QUEUED', 'attention'],
      ['PENDING', 'attention'],
      ['ASSIGNED', 'actionable'],
      ['PICKED_UP', 'actionable'],
      ['OUT_FOR_DELIVERY', 'actionable'],
    ];
    for (const [status, state] of expected) {
      expect(statusState(status), `${status} should be ${state}`).toBe(state);
    }
  });

  it('gives every state at least one status, so no state is dead vocabulary', () => {
    const states: StatusState[] = [
      'final',
      'failed',
      'attention',
      'actionable',
      'moving',
      'neutral',
    ];
    for (const state of states) {
      expect(statusesIn(state).length).toBeGreaterThan(0);
    }
  });

  it('never puts one status in two classes', () => {
    // The table is flattened into a map, so a duplicate would silently make the later class win — the
    // exact failure a hand-written `switch` has when two branches are added for the same value.
    const all = (
      ['final', 'failed', 'attention', 'actionable', 'moving', 'neutral'] as const
    ).flatMap((state) => statusesIn(state));
    expect(new Set(all).size).toBe(all.length);
  });

  it('has a readable label for every status it classifies', () => {
    // Words and meaning are two tables. This is the invariant that keeps them from drifting: a state
    // can be painted by a kit and named by another, and if the two disagree nobody notices until a
    // screen reads "On hold" in the colour of a failure.
    const all = (
      ['final', 'failed', 'attention', 'actionable', 'moving', 'neutral'] as const
    ).flatMap((state) => statusesIn(state));
    for (const status of all) {
      expect(statusLabel(status)).not.toBe(status);
      expect(statusLabel(status).length).toBeGreaterThan(0);
    }
  });
});

describe('formatMinor', () => {
  it('writes the canonical taka amount', () => {
    expect(formatMinor(125050, 'BDT')).toBe('৳ 1,250.50');
  });

  it('puts the sign outside the symbol', () => {
    // `Intl` puts it on the number, so composing the naive way yields `৳ -0.50` — a corrupted
    // currency sign and a stray dash. It is the format of every correction row on every statement.
    expect(formatMinor(-50, 'BDT')).toBe('-৳ 0.50');
  });

  it('pads a single-digit minor part', () => {
    expect(formatMinor(5, 'BDT')).toBe('৳ 0.05');
  });

  it('renders zero, because a balance of nothing is a real answer', () => {
    expect(formatMinor(0, 'BDT')).toBe('৳ 0.00');
  });

  it('is exact where a float divide is not', () => {
    // The nearest double to 2^53-1 is a hundredth of a minor unit short after a divide by 100, so it
    // renders `…409.90` for an amount that is `…409.91`. This is the assertion that keeps
    // `amountMinor / 100` out of every surface in the product.
    expect(formatMinor(Number.MAX_SAFE_INTEGER, 'BDT')).toBe('৳ 90,071,992,547,409.91');
  });

  it('groups without Intl, so a phone and a desktop agree', () => {
    // Hermes' Intl support is partial and `'en-BD'` is not `'en-US'`. A grouping difference between a
    // merchant's invoice and a rider's screen would never be reported and would always be true.
    expect(formatMinor(123456789, 'USD')).toBe('$ 1,234,567.89');
  });

  it('falls back to a bare figure for a currency it does not know', () => {
    expect(formatMinor(1234, 'JPY')).toBe(' 12.34');
  });
});

describe('splitMinor', () => {
  it('hands a renderer the parts without redoing the arithmetic', () => {
    expect(splitMinor(125050, 'BDT')).toEqual({
      sign: '',
      symbol: '৳',
      major: '1,250',
      minor: '50',
    });
  });

  it('keeps the sign out of the digits', () => {
    expect(splitMinor(-125050, 'BDT').major).toBe('1,250');
    expect(splitMinor(-125050, 'BDT').sign).toBe('-');
  });
});

describe('minorOf', () => {
  it('reads the API’s decimal string', () => {
    expect(minorOf('125050')).toBe(125050);
  });

  it('stays exact above the float boundary, because the wire value is an integer', () => {
    expect(Number.isSafeInteger(minorOf('9007199254740991'))).toBe(true);
  });
});

describe('formatAge', () => {
  const now = Date.parse('2026-10-13T10:00:00.000Z');
  const ago = (iso: string) => formatAge(iso, now);

  it('says "just now" inside the first minute', () => {
    expect(ago('2026-10-13T09:59:30.000Z')).toBe('just now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(ago('2026-10-13T09:56:00.000Z')).toBe('4 min ago');
    expect(ago('2026-10-13T07:00:00.000Z')).toBe('3 h ago');
    expect(ago('2026-10-11T10:00:00.000Z')).toBe('2 d ago');
  });

  it('rounds rather than truncating, so 45 seconds is not "0 min ago"', () => {
    // A truncation reads as *nothing has happened* when something has, which is the wrong way round
    // for the one number on a rider's list that is telling them whether to chase something.
    expect(ago('2026-10-13T09:59:00.000Z')).toBe('1 min ago');
  });

  it('never reports a negative age for a clock that disagrees', () => {
    // The device is behind the server's by a second now and then, and "-1 min ago" is worse than
    // "just now".
    expect(ago('2026-10-13T10:05:00.000Z')).toBe('just now');
  });

  it('answers "just now" for a value it cannot read, not an empty string', () => {
    // The rider's list used to render nothing where an age should be, which reads as a layout bug
    // rather than a missing value.
    expect(formatAge('not a date', now)).toBe('just now');
  });
});

describe('zoneLabel', () => {
  it('humanises a slug', () => {
    expect(zoneLabel('chattogram-metro')).toBe('Chattogram metro');
  });
});
