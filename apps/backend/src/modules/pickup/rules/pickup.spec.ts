import { describe, expect, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  PICKUP_STATUSES,
  PICKUP_TRANSITIONS,
  MAX_BATCH_PARCELS,
  MAX_BATCH_WEIGHT_GRAMS,
  assertTransition,
  canTransition,
  validateBatch,
  type PickupStatus,
} from './pickup.ts';
import { InvalidBatchError, InvalidTransitionError } from '../../../common/domain-error.ts';

describe('pickup state machine — exhaustive', () => {
  for (const from of PICKUP_STATUSES) {
    for (const to of PICKUP_STATUSES) {
      const legal = (PICKUP_TRANSITIONS[from] as readonly PickupStatus[]).includes(to);
      it(`${from} -> ${to} is ${legal ? 'allowed' : 'rejected'}`, () => {
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

describe('pickup batch bounds', () => {
  it('rejects an empty batch with a mapped 422, not a 500', () => {
    expect(() => validateBatch({ shipmentIds: [], totalWeightGrams: 1000 })).toThrow(
      InvalidBatchError,
    );
  });

  it('rejects a batch over the parcel count', () => {
    const ids = Array.from({ length: MAX_BATCH_PARCELS + 1 }, (_, i) => `s-${i}`);
    expect(() => validateBatch({ shipmentIds: ids, totalWeightGrams: 1000 })).toThrow(
      InvalidBatchError,
    );
  });

  it('rejects a batch over the weight limit', () => {
    expect(() =>
      validateBatch({ shipmentIds: ['s-1'], totalWeightGrams: MAX_BATCH_WEIGHT_GRAMS + 1 }),
    ).toThrow(InvalidBatchError);
  });

  it('carries the 422 code the envelope will use', () => {
    try {
      validateBatch({ shipmentIds: [], totalWeightGrams: 1000 });
      assert.fail('should have thrown');
    } catch (error) {
      assert.ok(error instanceof InvalidBatchError);
      assert.equal(error.spec.code, 'INVALID_BATCH');
      assert.equal(error.spec.status, 422);
    }
  });

  it('accepts a batch exactly at both limits', () => {
    const ids = Array.from({ length: MAX_BATCH_PARCELS }, (_, i) => `s-${i}`);
    expect(() =>
      validateBatch({ shipmentIds: ids, totalWeightGrams: MAX_BATCH_WEIGHT_GRAMS }),
    ).not.toThrow();
  });
});
