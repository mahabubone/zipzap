import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { decide, hashRequest, scopeKey } from '../src/common/idempotency.ts';

describe('hashRequest', () => {
  test('is insensitive to key order — the same body must hash the same', () => {
    assert.equal(
      hashRequest({ recipient: 'Ayesha', cod: 125050 }),
      hashRequest({ cod: 125050, recipient: 'Ayesha' }),
    );
  });

  test('is insensitive to nesting order', () => {
    assert.equal(
      hashRequest({ parcel: { weightKg: 2, count: 1 } }),
      hashRequest({ parcel: { count: 1, weightKg: 2 } }),
    );
  });

  test('is sensitive to value changes', () => {
    assert.notEqual(hashRequest({ cod: 125050 }), hashRequest({ cod: 125051 }));
  });

  test('ignores undefined properties rather than treating them as values', () => {
    assert.equal(hashRequest({ a: 1, b: undefined }), hashRequest({ a: 1 }));
  });

  test('distinguishes array order — [1,2] is not [2,1]', () => {
    assert.notEqual(hashRequest({ items: [1, 2] }), hashRequest({ items: [2, 1] }));
  });
});

describe('scopeKey', () => {
  test('isolates merchants so one can never read another response', () => {
    assert.notEqual(
      scopeKey({ scope: 'shipment.create', merchantId: 'a', key: 'order-1' }),
      scopeKey({ scope: 'shipment.create', merchantId: 'b', key: 'order-1' }),
    );
  });

  test('isolates operation classes', () => {
    assert.notEqual(
      scopeKey({ scope: 'shipment.create', merchantId: 'a', key: 'order-1' }),
      scopeKey({ scope: 'pickup.create', merchantId: 'a', key: 'order-1' }),
    );
  });

  test('handles anonymous callers without collapsing them together by accident', () => {
    assert.equal(
      scopeKey({ scope: 'public.track', merchantId: null, key: 'ZP-1' }),
      'public.track:anonymous:ZP-1',
    );
  });
});

describe('decide', () => {
  const hash = hashRequest({ cod: 125050 });

  test('a completed request replays its original response verbatim', () => {
    const result = decide(
      { requestHash: hash, responseCode: 201, responseBody: { id: 's1' } },
      hash,
    );
    assert.deepEqual(result, { outcome: 'replay', responseCode: 201, responseBody: { id: 's1' } });
  });

  test('replays even a failure — the client learns the original outcome, not a 409', () => {
    const result = decide(
      { requestHash: hash, responseCode: 422, responseBody: { code: 'X' } },
      hash,
    );
    assert.equal(result.outcome, 'replay');
    assert.equal(result.outcome === 'replay' && result.responseCode, 422);
  });

  test('the same key with a different body is a client bug, surfaced not hidden', () => {
    const result = decide({ requestHash: hash, responseCode: 201, responseBody: {} }, 'other-hash');
    assert.deepEqual(result, { outcome: 'key_reuse' });
  });

  test('an in-flight request is a duplicate, not permission to run the work twice', () => {
    const result = decide({ requestHash: hash, responseCode: null, responseBody: null }, hash);
    assert.equal(result.outcome, 'replay');
    assert.equal(result.outcome === 'replay' && result.responseCode, 409);
  });
});
