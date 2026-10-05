/**
 * Hub scans. Framework-free: no @nestjs, no typeorm.
 *
 * A scan kind is a physical gesture at a hub; the mapping says which shipment
 * transition and which timeline event it means. The shipment MACHINE validates
 * the transition (advance contract) — this table only translates vocabulary.
 *
 * DEPARTED writes no tracking event: DISPATCHED already told the customer the
 * parcel left, and "in transit" is internal line-haul state. Silence on the
 * timeline is a decision, not an omission — see the notes below each row.
 */

export const HUB_SCAN_KINDS = {
  /** Inbound: parcel arrives at an origin hub. */
  INBOUND: { to: 'AT_ORIGIN_HUB', eventType: 'ARRIVED_AT_HUB' },
  /** Sorted toward its destination. */
  SORT: { to: 'SORTING', eventType: 'SORTED' },
  /** Loaded onto the line-haul. */
  OUTBOUND: { to: 'DISPATCHED', eventType: 'DISPATCHED' },
  /** Line-haul departed — internal state; the timeline already says DISPATCHED. */
  DEPARTED: { to: 'IN_TRANSIT', eventType: null },
  /** Arrived at the destination hub, awaiting last-mile. */
  ARRIVED: { to: 'AT_DESTINATION_HUB', eventType: 'ARRIVED_AT_DESTINATION_HUB' },
} as const;

export type HubScanKind = keyof typeof HUB_SCAN_KINDS;

export const HUB_SCAN_ORDER: readonly HubScanKind[] = [
  'INBOUND',
  'SORT',
  'OUTBOUND',
  'DEPARTED',
  'ARRIVED',
];

export function isHubScanKind(value: string): value is HubScanKind {
  return Object.hasOwn(HUB_SCAN_KINDS, value);
}
