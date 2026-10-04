import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  COD_STATUSES,
  COD_TRANSITIONS,
  nextAfterReconcile,
  assertTransition,
  canTransition,
  reconcile,
  type CodStatus,
} from './cod.ts';
import { InvalidTransitionError } from '../../../common/domain-error.ts';

const ALL = COD_STATUSES;

describe('cod state machine — exhaustive', () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const legal = (COD_TRANSITIONS[from] as readonly CodStatus[]).includes(to);
      test(`${from} -> ${to} is ${legal ? 'allowed' : 'rejected'}`, () => {
        assert.equal(canTransition(from, to), legal);
        if (legal) {
          assert.doesNotThrow(() => assertTransition(from, to));
        } else {
          assert.throws(() => assertTransition(from, to), InvalidTransitionError);
        }
      });
    }
  }
});

describe('cod state machine — properties', () => {
  test('partial and exception both return to reconciliation, never forward', () => {
    assert.deepEqual([...COD_TRANSITIONS.PARTIAL_COLLECTION], ['COD_RECONCILED']);
    assert.deepEqual([...COD_TRANSITIONS.RECONCILIATION_EXCEPTION], ['COD_RECONCILED']);
  });

  test('a settled record accepts nothing further', () => {
    assert.deepEqual([...COD_TRANSITIONS.SETTLED], []);
    assert.deepEqual([...COD_TRANSITIONS.COLLECTION_FAILED], []);
  });
});

describe('reconcile — promise against reality', () => {
  test('exact match reconciles', () => {
    assert.deepEqual(reconcile({ expectedMinor: 125_050, collectedMinor: 125_050 }), {
      kind: 'MATCHED',
    });
  });

  test('a short collection is PARTIAL with the shortfall stated, never rounded', () => {
    assert.deepEqual(reconcile({ expectedMinor: 125_050, collectedMinor: 125_000 }), {
      kind: 'PARTIAL',
      shortfallMinor: 50,
    });
  });

  test('a single poisha short is still partial, not a match', () => {
    const outcome = reconcile({ expectedMinor: 125_050, collectedMinor: 125_049 });
    assert.equal(outcome.kind, 'PARTIAL');
    assert.equal((outcome as { shortfallMinor: number }).shortfallMinor, 1);
  });

  test('over-collection is a mismatch, not a bonus', () => {
    const outcome = reconcile({ expectedMinor: 125_050, collectedMinor: 130_000 });
    assert.equal(outcome.kind, 'MISMATCH');
  });

  test('zero collected against a positive expectation is partial for the full amount', () => {
    assert.deepEqual(reconcile({ expectedMinor: 125_050, collectedMinor: 0 }), {
      kind: 'PARTIAL',
      shortfallMinor: 125_050,
    });
  });

  test('outcomes map to the lifecycle without a default branch', () => {
    assert.equal(nextAfterReconcile({ kind: 'MATCHED' }), 'COD_COLLECTED');
    assert.equal(nextAfterReconcile({ kind: 'PARTIAL', shortfallMinor: 1 }), 'PARTIAL_COLLECTION');
    assert.equal(
      nextAfterReconcile({ kind: 'MISMATCH', shortfallMinor: -1 }),
      'RECONCILIATION_EXCEPTION',
    );
  });
});
