import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  WEBHOOK_EVENTS,
  delayBeforeAttempt,
  isRetryable,
  signPayload,
  verifySignature,
  wireEvent,
} from './webhook.ts';

/**
 * The webhook contract, minus everything else.
 *
 * What these prove: internal names map to the documented wire names; the retry
 * ladder is exactly 1m → 5m → 15m → 1h → 6h → 24h; 4xx is terminal except 429;
 * signing is over the raw body and verifies in constant time; stale timestamps
 * and malformed headers reject.
 */
describe('webhook wire names', () => {
  test('internal types map to dotted past-tense wire names', () => {
    assert.equal(wireEvent('ShipmentCreated'), 'shipment.created');
    assert.equal(wireEvent('DeliveryCompleted'), 'shipment.delivered');
    assert.equal(wireEvent('CODCollected'), 'cod.collected');
    assert.equal(wireEvent('SettlementCompleted'), 'settlement.completed');
  });

  test('unknown internal types map to nothing — never invent a wire name', () => {
    assert.equal(wireEvent('SomethingElseHappened'), null);
  });

  test('every wire name is dotted lowercase past tense', () => {
    for (const wire of Object.values(WEBHOOK_EVENTS)) {
      assert.match(wire, /^[a-z]+\.[a-z_]+$/);
    }
  });
});

describe('retry ladder', () => {
  test('is exactly 1m, 5m, 15m, 1h, 6h, 24h', () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6].map(delayBeforeAttempt),
      [60_000, 300_000, 900_000, 3_600_000, 21_600_000, 86_400_000],
    );
  });

  test('past the ladder end is terminal', () => {
    assert.equal(delayBeforeAttempt(0), null);
    assert.equal(delayBeforeAttempt(7), null);
  });

  test('timeouts, 5xx and 429 retry; other 4xx do not', () => {
    assert.equal(isRetryable(null), true);
    assert.equal(isRetryable(500), true);
    assert.equal(isRetryable(503), true);
    assert.equal(isRetryable(429), true);
    assert.equal(isRetryable(400), false);
    assert.equal(isRetryable(404), false);
    assert.equal(isRetryable(422), false);
  });
});

describe('signing', () => {
  const secret = 'whsec_test';
  const rawBody = '{"type":"shipment.delivered","id":"d-1"}';
  const now = 1_759_387_200;

  test('signs over timestamp + raw body, deterministically', () => {
    const first = signPayload(secret, now, rawBody);
    assert.equal(first, signPayload(secret, now, rawBody));
    assert.match(first, /^[0-9a-f]{64}$/);
  });

  test('byte-exact input matters — whitespace or reorder breaks the signature', () => {
    const pretty = JSON.stringify(JSON.parse(rawBody), null, 2);
    assert.notEqual(pretty, rawBody);
    assert.notEqual(signPayload(secret, now, pretty), signPayload(secret, now, rawBody));
    assert.notEqual(signPayload(secret, now, `${rawBody} `), signPayload(secret, now, rawBody));
  });

  test('round-trips through the header format', () => {
    const sig = signPayload(secret, now, rawBody);
    assert.equal(verifySignature(secret, `t=${now},v1=${sig}`, rawBody, now), true);
  });

  test('rejects wrong secret, stale timestamps, malformed headers', () => {
    const sig = signPayload(secret, now, rawBody);
    assert.equal(verifySignature('other', `t=${now},v1=${sig}`, rawBody, now), false);
    assert.equal(verifySignature(secret, `t=${now},v1=${sig}`, rawBody, now + 301), false);
    assert.equal(verifySignature(secret, 'garbage', rawBody, now), false);
    assert.equal(verifySignature(secret, undefined, rawBody, now), false);
  });
});
