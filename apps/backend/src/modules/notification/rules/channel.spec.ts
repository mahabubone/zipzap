import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { CARRIER_RETRY_POLICY, dedupeKey, isCarrierTerminal } from './channel.ts';

/**
 * The notification contract, minus everything else.
 *
 * What these prove: only retry-policy-0 dead-letters; the common real failures
 * (handset off, busy, system failure) do NOT; the dedupe key is exactly the
 * triple the domain doc names.
 */
describe('carrier dead-letter rule', () => {
  test('only retry-policy-0 is permanent', () => {
    assert.equal(isCarrierTerminal('Delivered'), true);
    assert.equal(isCarrierTerminal('Undelivered'), true);
    assert.equal(isCarrierTerminal('Barred subscriber'), true);
    assert.equal(isCarrierTerminal('Illegal subscriber'), true);
  });

  test('the common real failures are NOT terminal — the carrier retries', () => {
    assert.equal(isCarrierTerminal('Absent subscriber for SM'), false);
    assert.equal(isCarrierTerminal('Subscriber Busy'), false);
    assert.equal(isCarrierTerminal('System failure'), false);
  });

  test('the policy table matches the published DLR table', () => {
    assert.equal(CARRIER_RETRY_POLICY['Absent subscriber for SM'], 3);
    assert.equal(CARRIER_RETRY_POLICY['Subscriber Busy'], 3);
    assert.equal(CARRIER_RETRY_POLICY.Delivered, 0);
  });
});

describe('dedupe key', () => {
  test('is the (eventId, channel, recipient) triple', () => {
    assert.equal(dedupeKey('evt-1', 'sms', '+8801712345678'), 'evt-1:sms:+8801712345678');
    assert.notEqual(
      dedupeKey('evt-1', 'sms', '+8801712345678'),
      dedupeKey('evt-1', 'sms', '+8801812345678'),
    );
  });
});
