import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatClock,
  formatMinor,
  formatWhen,
  humanStatus,
  minorOf,
  scanAction,
  statusLabel,
  statusTone,
  zoneLabel,
} from './format.ts';

/**
 * The wording of a status is a product decision, so it is tested as one.
 *
 * Every app had its own copy of these functions and they had already drifted: the same status read
 * `In transit` in one surface and `in transit` in another, and the same poisha amount was written
 * three different ways by three formatters. A test per copy would have kept passing. A test per
 * decision catches the copy that diverges.
 */

const UNITS = 100;

describe('humanStatus', () => {
  it('title-cases a wire enum', () => {
    expect(humanStatus('IN_TRANSIT')).toBe('In transit');
    expect(humanStatus('OUT_FOR_DELIVERY')).toBe('Out for delivery');
  });

  it('does not invent a capital mid-word', () => {
    // `OUT_FOR_DELIVERY` → "Out for delivery", never "Out For Delivery": the underscores are word
    // boundaries chosen by the wire format, and capitalising each one makes a status look shouted.
    expect(humanStatus('OUT_FOR_DELIVERY')).not.toMatch(/For Delivery/);
  });

  it('falls back for an unrecognised status rather than rendering the raw enum', () => {
    // A new backend status must reach a human as words on the day it ships, not as `SOMETHING_NEW`
    // until someone remembers to update this file.
    expect(humanStatus('SOMETHING_NEW')).toBe('Something new');
  });
});

describe('statusLabel', () => {
  it('uses the vocabulary a person at the dock would use', () => {
    expect(statusLabel('INBOUND')).toBe('Inbound');
    expect(statusLabel('SORT')).toBe('Sort');
  });

  it('spells out a shipment status rather than lowercasing the enum', () => {
    expect(statusLabel('AT_ORIGIN_HUB')).toBe('At origin hub');
  });
});

describe('scanAction', () => {
  it('names the gesture, not the enum', () => {
    expect(scanAction('INBOUND')).toBe('Scan inbound');
    expect(scanAction('DEPARTED')).toBe('Scan departed');
  });

  it('degrades to something pressable for an unknown kind', () => {
    // The button is the whole interaction; a label that renders empty gives the operator a row with
    // no gesture and no explanation.
    expect(scanAction('TELEPORTED')).toBe('Scan');
  });
});

describe('statusTone', () => {
  it('colours by what a person must act on', () => {
    expect(statusTone('DELIVERED')).toBe('success');
    expect(statusTone('LOST')).toBe('danger');
    expect(statusTone('ON_HOLD')).toBe('warning');
    expect(statusTone('CREATED')).toBe('neutral');
    expect(statusTone('IN_TRANSIT')).toBe('info');
  });

  it('keeps prose and colour in agreement about what is finished', () => {
    // Two maps, deliberately: one is prose, one is colour. The audit that found six divergent copies
    // found them divergent in pairs, so this asserts the pair a reader would notice first — a state
    // worded as finished must also be coloured as finished.
    expect(statusLabel('DELIVERED')).toBe('Delivered');
    expect(statusTone('DELIVERED')).toBe('success');
    // …and one that is *not* finished, which is the case a naive "it reached a hub, close it out"
    // tone gets wrong.
    expect(statusLabel('AT_DESTINATION_HUB')).toBe('At destination hub');
    expect(statusTone('AT_DESTINATION_HUB')).toBe('info');
  });
});

describe('formatMinor', () => {
  it('writes an integer minor-unit amount without touching a float', () => {
    // 125050 poisha is ৳1,250.50 — and the backend's own `money.format()` writes exactly this.
    expect(formatMinor(125050, 'BDT')).toBe('৳1,250.50');
  });

  it('keeps the sign outside the symbol', () => {
    // `Intl` puts the sign on the number, so `৳-0.50` is what a naive implementation prints — which
    // reads as a corrupted currency sign and is the format of every correction row on a statement.
    expect(formatMinor(-50, 'BDT')).toBe('-৳0.50');
  });

  it('pads a single-digit minor part', () => {
    expect(formatMinor(5, 'BDT')).toBe('৳0.05');
  });

  it('splits in integer space, so the largest safe integer is exact', () => {
    // The nearest double to 2^53-1 is 100 minor units short of it after a divide by 100, which
    // renders `…409.90` for an amount that is `…409.91`. This is the assertion that keeps
    // `Math.abs(minor) / 100` out of this file. See docs/ADR/0009.
    const big = Number.MAX_SAFE_INTEGER;
    expect(formatMinor(big, 'BDT')).toBe('৳90,071,992,547,409.91');
  });

  it('renders zero', () => {
    expect(formatMinor(0, 'BDT')).toBe('৳0.00');
  });
});

describe('minorOf', () => {
  it('reads the API’s decimal string', () => {
    expect(minorOf('125050')).toBe(125050);
  });

  it('is exact for a value above the float boundary only because the wire value is an integer', () => {
    expect(Number.isSafeInteger(minorOf('9007199254740991'))).toBe(true);
  });
});

describe('zoneLabel', () => {
  it('humanises a slug', () => {
    expect(zoneLabel('chattogram-metro')).toBe('Chattogram metro');
  });
});

describe('formatWhen', () => {
  it('renders in Dhaka regardless of the machine’s own timezone', () => {
    // The fixed zone is the whole reason: a screenshot taken on a machine in UTC+0 and one in
    // UTC+7 must show the same clock, or the gallery lies to whoever compares them.
    expect(formatWhen('2026-10-07T16:39:47.960Z')).toBe('7 Oct 2026, 22:39');
  });
});

describe('formatClock', () => {
  it('renders the hour and minute in Dhaka', () => {
    expect(formatClock('2026-10-07T16:39:47.960Z')).toBe('22:39');
  });
});

describe('formatAgo', () => {
  const now = Date.parse('2026-10-13T10:00:00.000Z');
  const ago = (iso: string) => formatAgo(iso, now);

  it('says "just now" inside the first minute', () => {
    expect(ago('2026-10-13T09:59:30.000Z')).toBe('just now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(ago('2026-10-13T09:56:00.000Z')).toBe('4 min ago');
    expect(ago('2026-10-13T07:00:00.000Z')).toBe('3 h ago');
    expect(ago('2026-10-11T10:00:00.000Z')).toBe('2 d ago');
  });

  it('never reports a negative age for a clock that disagrees', () => {
    // The device clock is behind the server’s by a second now and then, and "-1 min ago" on a
    // work list is worse than "just now".
    expect(ago('2026-10-13T10:05:00.000Z')).toBe('just now');
  });

  it('rounds to the nearest unit, not down', () => {
    expect(ago('2026-10-13T09:59:00.000Z')).toBe('1 min ago');
  });
});

// Referenced so an unused-import lint cannot quietly delete the one helper this file exists to share.
void UNITS;
