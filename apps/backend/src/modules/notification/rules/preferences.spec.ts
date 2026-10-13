import { describe, expect, it } from 'vitest';
import {
  isEnabled,
  isNotifiableEvent,
  NOTIFIABLE_EVENTS,
  TEMPLATE_OF,
  type PreferenceRow,
} from './preferences.ts';
import { SMS_TEMPLATES } from '../sms-templates.ts';

/**
 * The one rule that decides whether a customer hears about their parcel.
 *
 * Every assertion here is about a *default*, which is the part that is easy to write and easy to
 * get backwards. The failure mode of defaulting off is silent and total — every merchant on the
 * platform stops being told where their parcels are, and no test anywhere fails, because each test
 * is looking at the switch it set rather than at the switch it did not.
 *
 * Two cases that look testable are deliberately absent. Duplicate rows for one event cannot exist —
 * `(merchant_id, event_type)` is the primary key — and a stored row for an event outside
 * NOTIFIABLE_EVENTS cannot exist either, because `event_type` is CHECK-constrained to it. Writing
 * tests for either would be testing a fiction, and a fiction that passes is worse than no test.
 */

const off: PreferenceRow = { eventType: 'DeliveryCompleted', enabled: false };
const on: PreferenceRow = { eventType: 'DeliveryCompleted', enabled: true };

describe('notification preferences', () => {
  it('sends when the merchant has never expressed a preference', () => {
    expect(isEnabled([], 'DeliveryCompleted')).toBe(true);
    expect(isEnabled([off], 'ShipmentCreated')).toBe(true);
  });

  it('honours a stored opt-out, and only that event', () => {
    const rows = [off];
    expect(isEnabled(rows, 'DeliveryCompleted')).toBe(false);
    expect(isEnabled(rows, 'ShipmentCreated')).toBe(true);
    expect(isEnabled(rows, 'DeliveryOutForDelivery')).toBe(true);
  });

  it('treats an explicit enabled row as on — the rule, not the row, is the default', () => {
    // The API deletes rather than storing this, so a row that says "on" should be unreachable in
    // practice. The rule must not depend on that: a row is a row, and it says what it says.
    expect(isEnabled([on], 'DeliveryCompleted')).toBe(true);
  });

  it('sends an event type it has never heard of, rather than dropping it', () => {
    // A new parcel event added to the consumer but not here must still notify. The alternative is
    // a silent, permanent drop of a real customer message with nothing in the logs but "ignored".
    // A stored row for such an event is not part of this case: `event_type` is CHECK-constrained to
    // NOTIFIABLE_EVENTS, so the only reachable state is the empty one.
    expect(isEnabled([], 'SomeBrandNewEvent')).toBe(true);
    expect(isEnabled([off], 'SomeBrandNewEvent')).toBe(true);
  });

  it('closes the vocabulary to exactly the events that notify', () => {
    expect(NOTIFIABLE_EVENTS).toEqual([
      'ShipmentCreated',
      'DeliveryOutForDelivery',
      'DeliveryCompleted',
    ]);
    for (const event of NOTIFIABLE_EVENTS) {
      expect(isNotifiableEvent(event)).toBe(true);
      expect(TEMPLATE_OF[event]).toBeTruthy();
    }
    expect(isNotifiableEvent('DeliveryProofCaptured')).toBe(false);
    expect(isNotifiableEvent('')).toBe(false);
  });

  /**
   * The coupling that made this worth a test rather than two constants. The preferences API offers a
   * toggle per entry in NOTIFIABLE_EVENTS, so an event with no template would produce a switch that
   * survives a save, renders in the screen, and never stops a message.
   */
  it('every configurable event resolves to a real template, in every locale', () => {
    for (const templateName of Object.values(TEMPLATE_OF)) {
      const locales = SMS_TEMPLATES.filter((t) => t.name === templateName).map((t) => t.locale);
      expect(locales.sort(), `${templateName} has no en + bn pair`).toEqual(['bn', 'en']);
    }
  });

  it('carries the union of both directions, so an event cannot be added to only one', () => {
    const mappable = Object.keys(TEMPLATE_OF);
    expect([...NOTIFIABLE_EVENTS].sort()).toEqual(mappable.sort());
  });
});
