/**
 * Which parcel events notify, and whether this merchant is listening. Framework-free.
 *
 * Two decisions live here, and both are cheap to get subtly wrong:
 *
 * 1. **The vocabulary.** An event that notifies is an event a merchant can be told about. The
 *    event-to-template map is the single source of that list — the consumer, the preferences API
 *    and the merchant screen all read it, so a fourth parcel event cannot be added to one and
 *    missed by the other two.
 * 2. **Absent means on.** No stored preference is not consent to send; it is an account that has
 *    never opened the page. The default is deliberately "send", because the alternative is the
 *    worst possible bug in this file: every existing merchant silently stops being told where
 *    their parcels are, and nothing anywhere reports it. A merchant who wants silence has to say
 *    so, and a row saying so is the only thing that can stop a message.
 */

/**
 * Outbox event type -> versioned template name.
 *
 * Lives in rules/ rather than inside the consumer because it is also the set of things a merchant
 * may configure, and a preferences screen offering four toggles for a consumer that honours two is
 * worse than no screen at all.
 */
export const TEMPLATE_OF: Readonly<Record<string, string>> = {
  ShipmentCreated: 'shipment.created',
  DeliveryOutForDelivery: 'shipment.out_for_delivery',
  DeliveryCompleted: 'shipment.delivered',
};

/** The closed set a merchant may configure. Anything else is rejected at the edge. */
export const NOTIFIABLE_EVENTS: readonly string[] = Object.keys(TEMPLATE_OF);

export function isNotifiableEvent(candidate: string): boolean {
  return NOTIFIABLE_EVENTS.includes(candidate);
}

export interface PreferenceRow {
  readonly eventType: string;
  readonly enabled: boolean;
}

/**
 * Whether one event should send, given every row stored for the merchant.
 *
 * Takes the whole set rather than one event's row, so a caller cannot pass an empty array it meant
 * to have filled. "No rows at all" and "no row for this event" are the same answer here, and that
 * sameness *is* the default-on rule rather than an oversight.
 */
export function isEnabled(rows: readonly PreferenceRow[], eventType: string): boolean {
  if (!isNotifiableEvent(eventType)) {
    // A new event type reaching here means the consumer learned about it and this file did not.
    // Sending is the safe answer; refusing would silently drop real notifications.
    return true;
  }
  return rows.find((row) => row.eventType === eventType)?.enabled ?? true;
}
