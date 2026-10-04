import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  RETURN_STATUSES,
  RETURN_TRANSITIONS,
  RETURN_REASONS,
  assertTransition,
  canTransition,
  type ReturnStatus,
} from './returns.ts';
import { InvalidTransitionError } from '../../../common/domain-error.ts';

const ALL = RETURN_STATUSES;

describe('return state machine — exhaustive', () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const legal = (RETURN_TRANSITIONS[from] as readonly ReturnStatus[]).includes(to);
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

describe('return state machine — properties', () => {
  test('rejection and completion are terminal', () => {
    assert.deepEqual([...RETURN_TRANSITIONS.RETURN_REJECTED], []);
    assert.deepEqual([...RETURN_TRANSITIONS.RETURNED], []);
  });

  test('the forward chain is linear — no skipping, no rewinding', () => {
    const chain: ReturnStatus[] = [
      'RETURN_REQUESTED',
      'RETURN_APPROVED',
      'RETURN_INITIATED',
      'RETURN_IN_TRANSIT',
      'RETURN_AT_HUB',
      'RETURN_OUT_FOR_DELIVERY',
      'RETURNED',
    ];
    for (let i = 0; i < chain.length - 1; i++) {
      assert.ok(canTransition(chain[i]!, chain[i + 1]!), `${chain[i]} -> ${chain[i + 1]}`);
      assert.ok(
        !canTransition(chain[i + 1]!, chain[i]!),
        `no rewind ${chain[i + 1]} -> ${chain[i]}`,
      );
    }
  });

  test('reasons are the documented closed set', () => {
    assert.deepEqual(
      [...RETURN_REASONS],
      [
        'CUSTOMER_REFUSED',
        'CUSTOMER_UNAVAILABLE',
        'WRONG_ADDRESS',
        'DAMAGED',
        'MERCHANT_REQUEST',
        'OTHER',
      ],
    );
  });
});
