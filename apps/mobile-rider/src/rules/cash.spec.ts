/**
 * Cash in hand, and the carry limit.
 *
 * The number these tests protect is the one a rider counts their pockets against. A display that
 * reads `৳0` on a phone holding cash is the failure this file exists to prevent, so most of these
 * assertions are about what gets _counted_, not about formatting.
 */

import { describe, expect, it } from 'vitest';
import { formatMinor } from '@zipzap/lexicon';
import {
  computeCashInHand,
  CASH_LIMIT_MINOR,
  formatCash,
  type CashCommand,
  type CashRuling,
} from './cash.ts';

function delivery(deviceSequence: number, collectedMinor: number): CashCommand {
  return {
    deviceSequence,
    commandType: 'zipzap.rider.delivery',
    payload: { shipmentId: `shp-${deviceSequence}`, collectedMinor },
  };
}

function pickup(deviceSequence: number): CashCommand {
  return {
    deviceSequence,
    commandType: 'zipzap.rider.pickup',
    payload: { shipmentId: `shp-${deviceSequence}` },
  };
}

function ruling(deviceSequence: number, kind: 'applied' | 'rejected' | 'duplicate'): CashRuling {
  return { deviceSequence, kind };
}

describe('computeCashInHand', () => {
  it('is zero with nothing queued', () => {
    expect(computeCashInHand([], []).collectedMinor).toBe(0);
  });

  it('counts a queued collection as unconfirmed until the server rules', () => {
    const cash = computeCashInHand([delivery(1, 125_050)], []);

    expect(cash.unconfirmedMinor).toBe(125_050);
    expect(cash.outstandingMinor).toBe(0);
  });

  it('moves a collection to outstanding once the server applies it', () => {
    const cash = computeCashInHand([delivery(1, 125_050)], [ruling(1, 'applied')]);

    expect(cash.outstandingMinor).toBe(125_050);
    expect(cash.unconfirmedMinor).toBe(0);
  });

  it('never double-counts a command that is both queued and settled', () => {
    // The regression this guards: a settled ruling on a row the device has not yet cleared out of
    // `pending` must not be counted in both buckets.
    const cash = computeCashInHand([delivery(1, 125_050)], [ruling(1, 'applied')]);

    expect(cash.collectedMinor).toBe(125_050);
  });

  it('still counts a rejected collection, because the rider is holding it', () => {
    // The server refused the command — a state mismatch, a cancelled parcel — not the cash in the
    // rider's hand. Subtracting it would tell a rider with ৳1,250 in their pocket that they carry
    // nothing, and the carry limit exists to stop exactly that.
    const cash = computeCashInHand([delivery(1, 125_050)], [ruling(1, 'rejected')]);

    expect(cash.collectedMinor).toBe(125_050);
    expect(cash.unconfirmedMinor).toBe(125_050);
    expect(cash.outstandingMinor).toBe(0);
  });

  it('counts a duplicate as outstanding, because the server banked it once', () => {
    const cash = computeCashInHand([delivery(1, 125_050)], [ruling(1, 'duplicate')]);

    expect(cash.outstandingMinor).toBe(125_050);
  });

  it('ignores commands that carry no money', () => {
    const cash = computeCashInHand([pickup(1)], []);

    expect(cash.collectedMinor).toBe(0);
  });

  it('ignores a malformed amount rather than producing NaN', () => {
    const bad: CashCommand = {
      deviceSequence: 1,
      commandType: 'zipzap.rider.delivery',
      payload: { collectedMinor: 'lots' },
    };

    // The whole display is unreadable if this arrives as NaN, and a rider cannot tell.
    expect(computeCashInHand([bad], []).collectedMinor).toBe(0);
  });

  it('counts a zero-COD delivery as nothing rather than as an amount', () => {
    const cash = computeCashInHand([delivery(1, 0)], [ruling(1, 'applied')]);

    expect(cash.collectedMinor).toBe(0);
  });
});

describe('the carry limit', () => {
  it('says nothing below the warning threshold', () => {
    const cash = computeCashInHand([], []);
    expect(cash.shouldWarn).toBe(false);
    expect(cash.shouldBlock).toBe(false);
  });

  it('warns at 80% before the rider collects more', () => {
    // A limit the rider learns about from a refusal is a limit that costs a wasted trip.
    const warned = computeCashInHand([], [], CASH_LIMIT_MINOR);
    void warned;

    const nearLimit = CASH_LIMIT_MINOR - 100;
    const cash = computeCashInHand([delivery(1, nearLimit)], [ruling(1, 'applied')]);

    expect(cash.shouldWarn).toBe(true);
    expect(cash.shouldBlock).toBe(false);
  });

  it('blocks at the limit itself', () => {
    const cash = computeCashInHand([delivery(1, CASH_LIMIT_MINOR)], [ruling(1, 'applied')]);

    expect(cash.shouldBlock).toBe(true);
  });
});

describe('formatCash', () => {
  // These five used to expect `৳237,555.00` and now expect `৳ 237,555.00`. The formatter moved to
  // `@zipzap/lexicon` — it needed `Intl`, which Hermes does not fully provide, and it was the third
  // implementation of a rule the other two had already disagreed with.
  //
  // What is asserted here is that this app still writes an amount the way the merchant's console does,
  // which is the part that was not true before and is the part that matters: a rider reading
  // `৳237,555.00` and a merchant reading `৳ 237,555.00` are looking at the same money written two ways.

  it('reads poisha as taka with two places', () => {
    expect(formatCash(23_755_500)).toBe('৳ 237,555.00');
  });

  it('pads a single-digit remainder', () => {
    expect(formatCash(12_305)).toBe('৳ 123.05');
  });

  it('reads a round taka figure without a stray decimal', () => {
    expect(formatCash(25_000)).toBe('৳ 250.00');
  });

  it('reads zero', () => {
    expect(formatCash(0)).toBe('৳ 0.00');
  });

  it('reads a negative as a shortage, not a minus sign', () => {
    expect(formatCash(-5_000)).toBe('-৳ 50.00');
  });

  it('writes the same string the merchant console writes', () => {
    // The assertion that makes the sharing worth having: compared through their public entry points, so
    // a change made to one side and not the other fails here rather than in a screenshot.
    expect(formatCash(12_305)).toBe(formatMinor(12_305, 'BDT'));
  });
});
