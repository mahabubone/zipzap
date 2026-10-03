import { describe, expect, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  DELIVERY_STATUSES,
  DELIVERY_TRANSITIONS,
  MAX_ATTEMPTS,
  assertTransition,
  attemptsRemain,
  isRetryable,
  type DeliveryStatus,
  type FailureReason,
} from './delivery.ts';
import { InvalidTransitionError } from '../../../common/domain-error.ts';

describe('delivery state machine — exhaustive', () => {
  for (const from of DELIVERY_STATUSES) {
    for (const to of DELIVERY_STATUSES) {
      const legal = (DELIVERY_TRANSITIONS[from] as readonly DeliveryStatus[]).includes(to);
      it(`${from} -> ${to} is ${legal ? 'allowed' : 'rejected'}`, () => {
        if (legal) {
          assert.doesNotThrow(() => assertTransition(from, to));
        } else {
          assert.throws(() => assertTransition(from, to), InvalidTransitionError);
        }
      });
    }
  }
});

describe('failure reasons — retryable versus terminal', () => {
  it('retries a customer who was unavailable, unreachable, or hit by weather', () => {
    for (const reason of [
      'CUSTOMER_UNAVAILABLE',
      'PHONE_UNREACHABLE',
      'ADDRESS_INCOMPLETE',
      'WEATHER',
      'OPERATIONAL_EXCEPTION',
    ] as const) {
      expect(isRetryable(reason)).toBe(true);
    }
  });

  it('ends the job on a wrong address, a refusal, a payment issue, or damage', () => {
    for (const reason of [
      'WRONG_ADDRESS',
      'CUSTOMER_REFUSED',
      'PAYMENT_ISSUE',
      'DAMAGED_PACKAGE',
    ] as const) {
      expect(isRetryable(reason as FailureReason)).toBe(false);
    }
  });

  it('bounds attempts: the third failure ends the job even for a retryable reason', () => {
    expect(attemptsRemain(0)).toBe(true);
    expect(attemptsRemain(MAX_ATTEMPTS - 1)).toBe(true);
    expect(attemptsRemain(MAX_ATTEMPTS)).toBe(false);
  });
});
