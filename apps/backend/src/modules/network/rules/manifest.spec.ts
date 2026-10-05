import { describe, expect, it } from 'vitest';
import {
  MANIFEST_STATUSES,
  assertManifestTransition,
  canManifestTransition,
  isManifestTerminal,
} from './manifest.ts';

/**
 * The transition table, asserted exhaustively: the four legal edges pass and
 * every other pair throws. Same shape as the shipment state-machine test —
 * this is the box "Manifest lifecycle" actually verifies.
 */

describe('manifest state machine', () => {
  it('allows exactly the four forward edges', () => {
    const legal: ReadonlyArray<[string, string]> = [
      ['DRAFT', 'SEALED'],
      ['SEALED', 'DISPATCHED'],
      ['DISPATCHED', 'RECEIVED'],
      ['RECEIVED', 'RECONCILED'],
    ];
    for (const [from, to] of legal) {
      expect(canManifestTransition(from as never, to as never)).toBe(true);
      expect(() => assertManifestTransition(from as never, to as never)).not.toThrow();
    }
  });

  it('rejects every other pair — skipping, repeating, reversing', () => {
    const legal = new Set([
      'DRAFT>SEALED',
      'SEALED>DISPATCHED',
      'DISPATCHED>RECEIVED',
      'RECEIVED>RECONCILED',
    ]);
    for (const from of MANIFEST_STATUSES) {
      for (const to of MANIFEST_STATUSES) {
        if (legal.has(`${from}>${to}`)) continue;
        expect(canManifestTransition(from, to)).toBe(false);
        expect(() => assertManifestTransition(from, to)).toThrow(/Cannot move from/);
      }
    }
  });

  it('RECONCILED is terminal', () => {
    expect(isManifestTerminal('RECONCILED')).toBe(true);
    expect(isManifestTerminal('RECEIVED')).toBe(false);
    expect(() => assertManifestTransition('RECONCILED', 'RECEIVED')).toThrow(
      /Cannot move from RECONCILED to RECEIVED/,
    );
  });
});
