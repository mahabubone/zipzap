/**
 * The notification toggle's optimistic update.
 *
 * These exist because the bug they cover shipped: an inline `map` set every row to the same
 * `enabled`, so one switch moved all three, and the screen then disagreed with the database.
 * The failure was only visible in a screenshot — `tsc` was happy, the request succeeded, and
 * nothing reported an error.
 */

import { describe, expect, it } from 'vitest';
import { applyToggle, revertToggle, type PreferenceRow } from './notification-preference.ts';

const ROWS: readonly PreferenceRow[] = [
  {
    eventType: 'ShipmentCreated',
    templateName: 'shipment.created',
    enabled: true,
    isDefault: true,
  },
  {
    eventType: 'DeliveryOutForDelivery',
    templateName: 'shipment.out_for_delivery',
    enabled: true,
    isDefault: true,
  },
  {
    eventType: 'DeliveryCompleted',
    templateName: 'shipment.delivered',
    enabled: true,
    isDefault: true,
  },
];

describe('applyToggle', () => {
  it('changes only the row that was tapped', () => {
    const next = applyToggle(ROWS, 'DeliveryOutForDelivery', false);

    // The regression this test is for. Before the fix all three came back `false`.
    expect(next.map((r) => r.enabled)).toEqual([true, false, true]);
    expect(next.filter((r) => r.enabled)).toHaveLength(2);
  });

  it('leaves the other rows referentially untouched', () => {
    const next = applyToggle(ROWS, 'DeliveryCompleted', false);

    // Not just equal — the same objects. A re-render that rebuilds every row defeats the
    // point of scoping the update, and React cannot bail out of the re-render.
    expect(next[0]).toBe(ROWS[0]);
    expect(next[1]).toBe(ROWS[1]);
    expect(next[2]).not.toBe(ROWS[2]);
  });

  it('marks a restored message as the default, because that is what the server stores', () => {
    // Turning a message back on is not an action the server records: `clearPreference` DELETES the
    // row, because absence means on. So "back on" and "never muted" are the same row — or rather
    // the same absence of one — and the copy is entitled to say "On — default".
    //
    // This assertion is the inverse of the obvious one, and it is the one worth pinning: the
    // alternative (`isDefault: false`) would claim the merchant took an action the database has no
    // record of.
    const restored = applyToggle(ROWS, 'ShipmentCreated', true);

    expect(restored[0]).toEqual({
      eventType: 'ShipmentCreated',
      templateName: 'shipment.created',
      enabled: true,
      isDefault: true,
    });
  });

  it('marks a muted message as not-the-default, which is the one state a row exists for', () => {
    const muted = applyToggle(ROWS, 'ShipmentCreated', false);

    // A row in `merchant_preferences` only exists to say "off". `isDefault: false` is what makes
    // the copy read "Off — this message is not being sent" instead of "Off — default".
    expect(muted[0]?.isDefault).toBe(false);
  });

  it('is a no-op for an event type that is not in the list', () => {
    // A toggle for a row the screen is not showing must not invent one. Absence means on, so
    // there is nothing to write for an unknown type.
    expect(applyToggle(ROWS, 'ShipmentHeld', false)).toEqual(ROWS);
  });

  it('does not mutate the input', () => {
    const snapshot = structuredClone(ROWS);
    applyToggle(ROWS, 'DeliveryOutForDelivery', false);

    expect(ROWS).toEqual(snapshot);
  });
});

describe('revertToggle', () => {
  it('restores only the failed row', () => {
    const optimistic = applyToggle(ROWS, 'DeliveryOutForDelivery', false);
    const reverted = revertToggle(optimistic, 'DeliveryOutForDelivery', true);

    expect(reverted.map((r) => r.enabled)).toEqual([true, true, true]);
  });

  it('does not undo a toggle the merchant made while the save was in flight', () => {
    // The failure mode of reverting every row: two taps, one request, and the second tap is
    // silently undone. Reverting must be scoped exactly as tightly as applying was.
    const optimistic = applyToggle(ROWS, 'DeliveryOutForDelivery', false);
    const alsoMuted = applyToggle(optimistic, 'DeliveryCompleted', false);
    const reverted = revertToggle(alsoMuted, 'DeliveryOutForDelivery', true);

    expect(reverted.map((r) => r.enabled)).toEqual([true, true, false]);
  });
});
