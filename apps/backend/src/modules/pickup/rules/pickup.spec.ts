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
import { InvalidTransitionError } from '../../../common/domain-error.ts';

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
  it('rejects an empty batch', () => {
    expect(() => validateBatch({ shipmentIds: [], totalWeightGrams: 1000 })).toThrow(
      /at least one shipment/,
    );
  });

  it('rejects a batch over the parcel count', () => {
    const ids = Array.from({ length: MAX_BATCH_PARCELS + 1 }, (_, i) => `s-${i}`);
    expect(() => validateBatch({ shipmentIds: ids, totalWeightGrams: 1000 })).toThrow(
      new RegExp(String(MAX_BATCH_PARCELS)),
    );
  });

  it('rejects a batch over the weight limit', () => {
    expect(() =>
      validateBatch({ shipmentIds: ['s-1'], totalWeightGrams: MAX_BATCH_WEIGHT_GRAMS + 1 }),
    ).toThrow(/weight/);
  });

  it('accepts a batch exactly at both limits', () => {
    const ids = Array.from({ length: MAX_BATCH_PARCELS }, (_, i) => `s-${i}`);
    expect(() =>
      validateBatch({ shipmentIds: ids, totalWeightGrams: MAX_BATCH_WEIGHT_GRAMS }),
    ).not.toThrow();
  });
});
