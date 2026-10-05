import { describe, expect, it } from 'vitest';
import { HUB_SCAN_KINDS, HUB_SCAN_ORDER, isHubScanKind } from './scan.ts';
import { canTransition } from '../../shipment/rules/state-machine.ts';

/**
 * The scan table must agree with the shipment machine — every mapping edge is
 * asserted, so a scan kind can never 409 because the TABLE asked for an
 * impossible transition (the machine rejecting a real out-of-order scan at
 * runtime is correct; the table causing it would be a bug).
 */

describe('hub scan kinds', () => {
  it('maps to a transition the shipment machine allows', () => {
    expect(canTransition('PICKED_UP', HUB_SCAN_KINDS.INBOUND.to)).toBe(true);
    expect(canTransition('AT_ORIGIN_HUB', HUB_SCAN_KINDS.SORT.to)).toBe(true);
    expect(canTransition('SORTING', HUB_SCAN_KINDS.OUTBOUND.to)).toBe(true);
    expect(canTransition('DISPATCHED', HUB_SCAN_KINDS.DEPARTED.to)).toBe(true);
    expect(canTransition('IN_TRANSIT', HUB_SCAN_KINDS.ARRIVED.to)).toBe(true);
  });

  it('DEPARTED alone writes no timeline event', () => {
    expect(HUB_SCAN_KINDS.DEPARTED.eventType).toBeNull();
    for (const kind of HUB_SCAN_ORDER.filter((k) => k !== 'DEPARTED')) {
      expect(HUB_SCAN_KINDS[kind].eventType, kind).not.toBeNull();
    }
  });

  it('recognises exactly the five kinds', () => {
    expect(HUB_SCAN_ORDER).toEqual(['INBOUND', 'SORT', 'OUTBOUND', 'DEPARTED', 'ARRIVED']);
    expect(isHubScanKind('INBOUND')).toBe(true);
    expect(isHubScanKind('DROP')).toBe(false);
  });
});
