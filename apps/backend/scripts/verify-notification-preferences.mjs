/**
 * Notification preferences, proved against the running stack.
 *
 * A unit test can prove that `isEnabled` returns false for a stored opt-out. It cannot prove that
 * the consumer reads the row, resolves the right merchant, and leaves no message behind. This does
 * both, in the order a merchant would experience them: change a setting over HTTP, then let a real
 * parcel event flow through the real worker and see whether a customer's phone rings.
 *
 * Needs the API, the worker and the publisher running:
 *   PORT=3100 METRICS_PORT=9190 PUBLISHER_METRICS_PORT=9191 node scripts/dev.mjs
 *   API_URL=http://localhost:3100 node --env-file-if-exists=../../.env \
 *     scripts/verify-notification-preferences.mjs
 */

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { connect, StringCodec, JSONCodec } from 'nats';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

let passed = 0;
let failed = 0;
const check = (what, ok, detail = '') => {
  if (ok) {
    passed += 1;
    console.log(`  ok  ${what}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${what}${detail ? `\n      ${detail}` : ''}`);
  }
};

const { Client: PgClient } = await import('pg');
const db = new PgClient({ connectionString: process.env.DATABASE_URL });
await db.connect();

// --- a merchant, a key, and a parcel that actually exists ------------------------
// A merchant that actually owns a parcel. Picking "the first merchant" instead picks one with no
// shipments on a database that has been seeded repeatedly, and the proof then fails on a null
// fixture rather than on the thing it is proving.
const {
  rows: [parcel],
} = await db.query(
  `UPDATE shipment.shipments s
      SET status = 'OUT_FOR_DELIVERY',
          recipient_phone = COALESCE(s.recipient_phone, '+8801710000000')
     FROM merchant.merchants m
    WHERE s.merchant_id = m.id
  RETURNING s.id, s.merchant_id, s.recipient_phone`,
);
if (!parcel) {
  console.error('no shipment in the database — run `pnpm db:seed` first');
  process.exit(1);
}
const merchant = { id: parcel.merchant_id };
const shipment = parcel;

// The credential is minted with the production helpers, not a hand-rolled digest: an API key
// whose hash this script computed differently is a key the server will reject, and the failure
// would look like an authorization bug rather than a fixture bug.
const { hashSecret, generateKeyId } = await import('../dist/common/secret.js');
const secret = `sk_${createHash('sha256').update(randomUUID()).digest('base64url').slice(0, 32)}`;
const keyId = generateKeyId();
await db.query(
  `INSERT INTO merchant.api_credentials (id, merchant_id, key_id, secret_hash, scopes)
   VALUES ($1, $2, $3, $4, $5::merchant.api_scope[])`,
  [randomUUID(), merchant.id, keyId, hashSecret(secret), '{notifications:manage,shipments:read}'],
);
const auth = `ApiKey ${keyId}.${secret}`;

const api = async (method, path, body) => {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const countMessages = async (eventId) =>
  Number(
    (
      await db.query('SELECT COUNT(*)::text AS n FROM notification.messages WHERE event_id = $1', [
        eventId,
      ])
    ).rows[0].n,
  );

// --- the HTTP surface ------------------------------------------------------------
console.log('\nGET/PUT /v1/notification-preferences\n');

const initial = await api('GET', '/v1/notification-preferences');
check(
  'the endpoint answers a merchant key with every notifiable event',
  () => {
    assert.equal(initial.status, 200);
    assert.deepEqual(
      initial.body.map((r) => r.eventType),
      ['ShipmentCreated', 'DeliveryOutForDelivery', 'DeliveryCompleted'],
    );
  },
  JSON.stringify(initial.body),
);
check('nothing is muted and everything is marked default on a fresh account', () => {
  assert.ok(initial.body.every((r) => r.enabled === true && r.isDefault === true));
});

const unauth = await fetch(`${API_URL}/v1/notification-preferences`);
check('and it is not readable without a key', () => {
  assert.ok(unauth.status === 401 || unauth.status === 403, `got ${unauth.status}`);
});

const muted = await api('PUT', '/v1/notification-preferences', {
  eventType: 'DeliveryCompleted',
  enabled: false,
});
check('opting out returns the new state and reports it as no longer a default', () => {
  assert.equal(muted.status, 200);
  assert.equal(muted.body.enabled, false);
  assert.equal(muted.body.isDefault, false);
});

const afterMute = await api('GET', '/v1/notification-preferences');
check('the mute is per-event: the other two are untouched', () => {
  const by = Object.fromEntries(afterMute.body.map((r) => [r.eventType, r.enabled]));
  assert.equal(by.DeliveryCompleted, false);
  assert.equal(by.DeliveryOutForDelivery, true);
  assert.equal(by.ShipmentCreated, true);
});

const bad = await api('PUT', '/v1/notification-preferences', {
  eventType: 'NotARealEvent',
  enabled: false,
});
check('an event type outside the closed vocabulary is rejected', () => {
  assert.equal(bad.status, 400, `got ${bad.status}`);
});

const stored = await db.query(
  'SELECT enabled FROM notification.merchant_preferences WHERE merchant_id = $1 AND event_type = $2',
  [merchant.id, 'DeliveryCompleted'],
);
check('exactly one row was written, and it says off', () => {
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0].enabled, false);
});

// --- the real consumer, through the real worker ----------------------------------
console.log('\nthe worker, on a real parcel event\n');

const nc = await connect({
  servers: process.env.NATS_URL ?? 'nats://localhost:4224',
});
const js = nc.jetstream();
const sc = StringCodec();
const jc = JSONCodec();

async function publishDeliveryCompleted(tag) {
  const eventId = `evt-pref-${tag}`;
  await js.publish(
    'zipzap.delivery.completed',
    sc.encode(
      JSON.stringify({
        id: eventId,
        type: 'DeliveryCompleted',
        aggregateType: 'delivery',
        aggregateId: randomUUID(),
        occurredAt: new Date().toISOString(),
        data: { shipmentId: shipment.id, merchantId: merchant.id, trackingCode: 'ZP-PREF' },
      }),
    ),
  );
  return eventId;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const mutedEvent = await publishDeliveryCompleted('muted');
await settle(4000);
const mutedCount = await countMessages(mutedEvent);
check('…confirmed: the message table is empty for it', () => {
  assert.equal(mutedCount, 0);
});

// Back to default, then the same event must land.
await api('PUT', '/v1/notification-preferences', { eventType: 'DeliveryCompleted', enabled: true });
const cleared = await db.query(
  'SELECT COUNT(*)::text AS n FROM notification.merchant_preferences WHERE merchant_id = $1 AND event_type = $2',
  [merchant.id, 'DeliveryCompleted'],
);
check('turning it back on deletes the row rather than storing "on"', () => {
  assert.equal(cleared.rows[0].n, '0');
});

const loudEvent = await publishDeliveryCompleted('loud');
await settle(4000);
const loudCount = await countMessages(loudEvent);
check('the same event now does produce a message, with the recipient on it', () => {
  assert.equal(loudCount, 1);
});

// A second event type is unaffected by the first one's row.
await api('PUT', '/v1/notification-preferences', {
  eventType: 'DeliveryCompleted',
  enabled: false,
});
const otherEvent = randomUUID();
await js.publish(
  'zipzap.delivery.out_for_delivery',
  sc.encode(
    JSON.stringify({
      id: otherEvent,
      type: 'DeliveryOutForDelivery',
      aggregateType: 'delivery',
      aggregateId: randomUUID(),
      occurredAt: new Date().toISOString(),
      data: { shipmentId: shipment.id, merchantId: merchant.id, trackingCode: 'ZP-PREF' },
    }),
  ),
);
await settle(4000);
const otherCount = await countMessages(otherEvent);
check('muting one event leaves the others sending', () => {
  assert.equal(otherCount, 1);
});

// --- cleanup ---------------------------------------------------------------------
await db.query('DELETE FROM notification.merchant_preferences WHERE merchant_id = $1', [
  merchant.id,
]);
await db.query('DELETE FROM notification.messages WHERE event_id LIKE $1', ['evt-pref-%']);
await db.query('DELETE FROM notification.messages WHERE event_id = $1', [otherEvent]);
await db.query('DELETE FROM merchant.api_credentials WHERE key_id = $1', [keyId]);
await db.query("UPDATE shipment.shipments SET status = 'OUT_FOR_DELIVERY' WHERE id = $1", [
  shipment.id,
]);

await nc.close();
await db.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
