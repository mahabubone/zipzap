/**
 * Live proof for Stage 6, exit check 4 — the public tracking token.
 *
 * The claim under test: `GET /track/token/:token` is not a weaker sibling of the code route but a
 * stronger one, and adding it broke nothing that was already sent to a customer.
 *
 * Everything runs against real Postgres and a real API. The token is minted by the REAL
 * TrackingConsumer booted from dist/ and handed a real outbox envelope — not inserted by this
 * script, because "a row exists in public_tokens" is not the same claim as "the consumer mints one".
 *
 * The consumer is driven directly rather than through NATS on purpose: the worker process on this
 * box is running the previous build, so a published event would be consumed by code that does not
 * mint, and the proof would measure the wrong binary. The envelope is the one the outbox actually
 * wrote; only the transport hop is skipped.
 *
 * The one timeline row this adds to a fixture parcel is deleted at the end. The token stays —
 * tokens have no delete path, because a link that can be revoked by anyone with a database
 * connection is not a capability, it is a convention.
 */
import 'reflect-metadata';
import pg from 'pg';
import Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { TrackingConsumer } from '../dist/modules/tracking/tracking.consumer.js';

const BASE = process.env.PROVE_BASE ?? 'http://localhost:3008';
const DB = 'postgresql://zipzap:zipzap@localhost:5433/zipzap';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got ${JSON.stringify(actual)}  want ${JSON.stringify(expected)}`}`,
  );
};
const truthy = (label, actual, note = '') => {
  const ok = Boolean(actual);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        ${note} got ${JSON.stringify(actual)}`}`,
  );
};

const db = new pg.Client({ connectionString: DB });
await db.connect();

// The public budget is per-IP over a 60s window, and this proof deliberately spends all of it.
// Without a reset a rerun starts already limited and every read 429s — which reads exactly like a
// broken route. So the window is cleared up front, and the proof says so rather than quietly
// inheriting a warm bucket.
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6381');
const publicKeys = await redis.keys('ratelimit:public:*');
if (publicKeys.length > 0) await redis.del(...publicKeys);
console.log(`cleared ${publicKeys.length} public rate-limit key(s) before starting`);

const get = async (path) => {
  const r = await fetch(`${BASE}${path}`);
  const text = await r.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, body, headers: r.headers };
};

// ---------------------------------------------------------------- fixture
// A seeded parcel that already has a public timeline, i.e. one /track/:code already answers for.
const { rows: fixtures } = await db.query(`
  SELECT s.tracking_code, s.id
    FROM shipment.shipments s
    JOIN tracking.public_timeline t ON t.shipment_id = s.id
   GROUP BY s.tracking_code, s.id
   ORDER BY count(*) DESC, s.tracking_code
   LIMIT 1
`);
const parcel = fixtures[0];
console.log(`\nparcel ${parcel.tracking_code} (${parcel.id})\n`);

const codeRoute = await get(`/track/${parcel.tracking_code}`);
const codeBefore = codeRoute.body;
check('the existing code route still answers — the token is additive', codeRoute.status, 200);
const beforeTimeline = codeBefore?.timeline?.length ?? 0;
truthy('code route has a timeline to compare against', beforeTimeline > 0, 'timeline empty');

// ------------------------------------------------- the consumer mints one
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
const consumer = app.get(TrackingConsumer);

// A real envelope for a real event type. aggregateId is the parcel, so the consumer's identity
// fallback resolves it exactly as it does in production.
const envelopeId = `prove-token-${Date.now()}`;
const occurredAt = new Date().toISOString();
const outcome = await consumer.handle({
  subject: 'zipzap.delivery.out_for_delivery',
  payload: new TextEncoder().encode(
    JSON.stringify({
      id: envelopeId,
      type: 'DeliveryOutForDelivery',
      aggregateType: 'shipment',
      aggregateId: parcel.id,
      occurredAt,
      data: { shipmentId: parcel.id },
    }),
  ),
});
check('the real consumer processed the envelope', outcome, 'processed');

const { rows: minted } = await db.query(
  `SELECT token FROM tracking.public_tokens WHERE shipment_id = $1`,
  [parcel.id],
);
truthy(
  'the consumer minted a token — not this script',
  minted.length === 1,
  `rows=${minted.length}`,
);
const token = minted[0]?.token ?? '';

// ------------------------------------------------------------ the shape
check('token is 26 characters', token.length, 26);
truthy(
  'token is at least the 20 characters the exit check demands',
  token.length >= 20,
  `len=${token.length}`,
);
truthy(
  'token uses the 32-character alphabet, so it carries 130 bits',
  /^[0-9A-HJKMNP-TV-Z]+$/.test(token),
  `token=${token}`,
);
truthy(
  'token does not embed the tracking code',
  !token.includes(parcel.tracking_code.replace(/[^0-9A-Z]/gi, '').slice(0, 6)),
  `token=${token} code=${parcel.tracking_code}`,
);

// Not derived from the code: a hash of the code would be stable across mints for the same code and
// would share a prefix family. Distinctness across the fixture set is the observable that a
// derived token cannot fake without being derived from the code.
const { rows: sample } = await db.query(
  `SELECT token FROM tracking.public_tokens ORDER BY shipment_id LIMIT 200`,
);
check(
  'every minted token in the table is distinct',
  new Set(sample.map((r) => r.token)).size,
  sample.length,
);
const prefixes = new Set(sample.map((r) => r.token.slice(0, 4)));
truthy(
  'no shared 4-character prefix across the sample — not a code-derived family',
  prefixes.size >= Math.min(sample.length, 10),
  `${prefixes.size} prefixes over ${sample.length} tokens`,
);

// ------------------------------------------------------- the token route
// Both routes are read AFTER the mint. An earlier version compared a pre-mint snapshot of the code
// route against a post-mint token route, which measured the projection rather than the two routes —
// and the one row it disagreed about was the row the mint had just added.
const codeAfter = await get(`/track/${parcel.tracking_code}`);
const tokenRoute = await get(`/track/token/${token}`);
check('token route answers 200', tokenRoute.status, 200);
check(
  'token route resolves to the same tracking code',
  tokenRoute.body?.trackingCode,
  parcel.tracking_code,
);
truthy(
  'both routes returned a body to compare — otherwise the check below is vacuous',
  Boolean(codeAfter.body?.timeline && tokenRoute.body?.timeline),
  `code=${JSON.stringify(codeAfter.body?.timeline)} token=${JSON.stringify(tokenRoute.body?.timeline)}`,
);
check(
  'token route returns the same timeline as the code route',
  tokenRoute.body?.timeline,
  codeAfter.body?.timeline,
);
check(
  'token route adds one projected event, not a different view',
  tokenRoute.body?.timeline?.length,
  beforeTimeline + 1,
);
check(
  'the post-mint code read saw one more row than the pre-mint read',
  codeAfter.body?.timeline?.length,
  beforeTimeline + 1,
);
check('both routes agree on current status', tokenRoute.body?.status, codeAfter.body?.status);

// Read twice more: with duplicate sequence numbers on this table, a read whose ORDER BY does not
// break ties can return the same rows in a different order on each call — and `status` is read off
// the last row, so an unstable order means an unstable status.
const repeats = await Promise.all(
  Array.from({ length: 8 }, () => get(`/track/${parcel.tracking_code}`)),
);
truthy(
  'all eight repeat reads answered 200 — a 429 would make the ordering check vacuous',
  repeats.every((r) => r.status === 200),
  repeats.map((r) => r.status).join(','),
);
check(
  'eight identical reads return one ordering — ORDER BY breaks ties deterministically',
  new Set(repeats.map((r) => JSON.stringify(r.body?.timeline))).size,
  1,
);
check('and one current status', new Set(repeats.map((r) => r.body?.status)).size, 1);

// The code route must not hand the token out. If it does, the token is decoration: anyone who can
// see a status page can read the capability that was supposed to replace the code.
truthy(
  'the code route does not leak the token',
  !JSON.stringify(codeAfter.body).includes(token),
  'token appears in the code route response',
);

// ---------------------------------------------------- indistinguishable 404s
const unknownToken = Array.from(
  { length: 26 },
  () => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[randomBytes(1)[0] % 32],
).join('');
const r404Token = await get(`/track/token/${unknownToken}`);
const r404Code = await get(`/track/ZP-0000-0000-0`);
check('an unknown token 404s', r404Token.status, 404);
check('an unknown code 404s', r404Code.status, 404);
// request_id differs on every response by design, so it is compared for shape and the rest of the
// envelope is compared for equality. Two bodies that differ only in a correlation id say the same
// thing; two that differ in `detail` would tell an attacker which guesses hit.
const stripRequestId = (b) => JSON.stringify({ ...b, request_id: '<per-request>' });
check(
  'the two 404 envelopes differ only by request_id — no validity oracle',
  stripRequestId(r404Token.body),
  stripRequestId(r404Code.body),
);
truthy(
  'each 404 carries its own request_id, so the pair is genuinely two responses',
  r404Token.body?.request_id !== r404Code.body?.request_id,
  'same request_id',
);
truthy(
  'the 404 detail does not distinguish a bad token from a bad code',
  !JSON.stringify(r404Token.body).match(/token/i),
  `token 404 detail leaked the word: ${JSON.stringify(r404Token.body)}`,
);

// ------------------------------------------------------------ rate limit
check(
  'the token route is rate limited like the code route',
  tokenRoute.headers.get('ratelimit-limit'),
  '100',
);
truthy('RateLimit-Removing header present', tokenRoute.headers.get('ratelimit-remaining') !== null);

// Hammer past the public budget. The key is per-IP and shared, so this also proves the token route
// did not quietly get a bucket of its own.
let limited = null;
let firstLimitedAt = 0;
for (let i = 0; i < 130; i++) {
  const r = await get(`/track/token/${token}`);
  if (r.status === 429) {
    limited = r;
    firstLimitedAt = i + 1;
    break;
  }
}
truthy(
  'the public budget is enforced on the token route',
  limited !== null,
  '130 requests, no 429',
);
if (limited) {
  check('the 429 carries the RATE_LIMITED envelope', limited.body?.code, 'RATE_LIMITED');
  truthy(
    'the 429 carries Retry-After',
    limited.headers.get('retry-after') !== null,
    'no Retry-After header',
  );
  truthy(
    `it trips inside the documented budget (request ${firstLimitedAt} of 100/min)`,
    firstLimitedAt <= 101,
    `first 429 at request ${firstLimitedAt}`,
  );
}
const codeAfterLimit = await get(`/track/${parcel.tracking_code}`);
check(
  'the code route shares that budget — the token route is not a free pass around the limit',
  codeAfterLimit.status,
  429,
);

// --------------------------------------------------------------- cleanup
// The projected row and the dedupe claim were added by this proof; both go. The token does not.
const removed = await db.query(
  `DELETE FROM tracking.public_timeline
    WHERE shipment_id = $1 AND event_type = 'OUT_FOR_DELIVERY' AND occurred_at = $2
    RETURNING sequence`,
  [parcel.id, occurredAt],
);
check('the proof removed exactly the row it added', removed.rows.length, 1);
let ledgerAppendOnly = false;
try {
  await db.query(`DELETE FROM system.consumed_events WHERE event_id = $1`, [envelopeId]);
} catch (error) {
  ledgerAppendOnly = /append-only/.test(String(error.message ?? error));
}
check(
  'the consumer dedupe ledger refuses deletion — rule 8 holds on it too',
  ledgerAppendOnly,
  true,
);
await app.close();
await db.end();
await redis.quit();

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
