/**
 * Stage 6b, exit check 2 — "a signature is verified from the raw body by a script a stranger could
 * write from the docs alone."
 *
 * The claim is about DOCUMENT SUFFICIENCY, not about our signer being correct. Our signer has unit
 * tests; what those cannot prove is whether a merchant who has only docs/api/webhooks.md can verify
 * our signature. So this script is built to be the merchant, not the platform:
 *
 *   - The verifier below imports NOTHING from this repo. Only `node:crypto`. If it needs a helper
 *     from `rules/webhook.ts`, the docs failed to say something, and the exit check fails.
 *   - The bytes it verifies are the bytes that crossed a real socket. The signer is production
 *     `sendAttempt` booted from `dist/`, not a reimplementation — a proof that signs its own
 *     fixtures with its own code proves only that the code agrees with itself.
 *   - It answers the failure mode the docs warn about, because that is the one that costs a merchant
 *     an afternoon: re-serialising the parsed JSON instead of signing the raw body.
 *
 * No database and no API process are involved, deliberately. `sendAttempt` takes its `fetcher` as a
 * parameter and uses the DataSource only to append the immutable delivery row; the signing happens
 * before that and is independent of it. Standing up Postgres to watch an HMAC hash is a ceremony
 * that proves nothing extra.
 *
 * Run: node apps/backend/scripts/verify-webhook-signature.mjs
 */
import 'reflect-metadata';
import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const { sendAttempt } = await import('../dist/modules/merchant/webhook-sender.service.js');

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The stranger's receiver. Written from docs/api/webhooks.md and nothing else.
//
//   "HMAC-SHA256 over {timestamp}.{raw_body} with the endpoint's signing secret, comparing in
//    constant time."  +  header format  t=<unix seconds>,v1=<hex>
//
// ponytail: sync verification. A streaming body check would need the raw bytes buffered anyway,
// which is what the docs tell receivers to do — the whole point is that the signature covers the
// bytes on the wire, so any correct receiver must hold them.
// ─────────────────────────────────────────────────────────────────────────────
const TOLERANCE_SECONDS = 300; // docs: "within tolerance (5 minutes)"

function verifyFromDocs(secret, header, rawBody, nowSeconds) {
  const match = /^t=(\d+),v1=([0-9a-fA-F]+)$/.exec(String(header).trim());
  if (!match) return false;
  const [, timestamp, providedHex] = match;
  const now = nowSeconds ?? Math.trunc(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const expectedHex = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(providedHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ─── the merchant endpoint: a real HTTP server, so the bytes are real ────────
const SECRET = 'whsec_stranger_proof_0123456789abcdef';
const received = [];

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    // Buffer the raw bytes exactly as they arrived. No parsing before verification — that is the
    // whole discipline the docs are trying to teach.
    received.push({
      rawBody: Buffer.concat(chunks).toString('utf8'),
      signature: req.headers['zipzap-signature'],
      delivery: req.headers['zipzap-delivery'],
      event: req.headers['zipzap-event'],
      attempt: req.headers['zipzap-attempt'],
    });
    res.writeHead(204).end();
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/hook`;

// `sendAttempt` records its delivery row through this. The proof never asserts on it — it exists so
// the signer can run unmodified rather than being reimplemented for the test.
const merchant = { transaction: async (fn) => fn({}) };
const repository = { insertDelivery: async () => ({}) };

const PAYLOAD = {
  id: 'dlv_stranger0001',
  type: 'shipment.delivered',
  merchantId: 'mch_stranger',
  shipmentId: 'shp_stranger',
  trackingCode: 'ZP-ABCD2345',
  collectedMinor: 125050,
  currency: 'BDT',
  occurredAt: '2026-10-10T06:42:11.000Z',
};

// ─── 1. a real delivery, signed by production code ──────────────────────────
const sent = await sendAttempt(
  merchant,
  repository,
  {
    deliveryId: 'dlv_stranger0001',
    endpointId: 'wep_stranger',
    merchantId: 'mch_stranger',
    url: endpoint,
    secret: SECRET,
    wireEvent: 'shipment.delivered',
    payload: PAYLOAD,
  },
  1,
);

check('the delivery was accepted by the receiver', sent.delivered, `status ${sent.statusCode}`);
check('exactly one request reached the merchant endpoint', received.length === 1);

const got = received[0] ?? {};
const parsed = JSON.parse(got.rawBody);
check('the sender emitted the documented header', typeof got.signature === 'string');
check(
  'the header matches the documented shape t=<seconds>,v1=<hex>',
  /^t=\d+,v1=[0-9a-f]{64}$/.test(String(got.signature)),
  `got ${got.signature}`,
);
check('a delivery id rides along for deduplication', typeof got.delivery === 'string', String(got.delivery));
check('the event name rides along', got.event === 'shipment.delivered', String(got.event));
check('the attempt number rides along', got.attempt === '1', String(got.attempt));

// ─── 2. a stranger verifies it from the docs ────────────────────────────────
check(
  'DOCS SUFFICIENT: a verifier written from webhooks.md alone accepts the real signature',
  verifyFromDocs(SECRET, got.signature, got.rawBody),
);
check(
  'the body on the wire is the payload, byte for byte',
  got.rawBody === JSON.stringify(PAYLOAD),
);
check('the payload carries integer minor units, never a decimal', typeof parsed.collectedMinor === 'number' && Number.isInteger(parsed.collectedMinor));

// ─── 3. the warnings the docs give are the failures that actually happen ───
// The docs warn that re-serialising breaks verification. This proves WHY, because the reason matters:
// `JSON.parse` + `JSON.stringify` in JavaScript round-trips EXACTLY, key order intact. The receivers
// that actually break are typed ones — a Go struct, a Java class, a PHP assoc array — whose field
// order comes from the type declaration, not the wire. Whitespace and float formatting break it too.
const reserialised = [
  ['reordered by a typed model (Go struct / PHP array)', JSON.stringify({ ...parsed, id: 'dlv_stranger0001' }, Object.keys(parsed).reverse())],
  ['pretty-printed', JSON.stringify(parsed, null, 2)],
  ['float-formatted (125050 -> 125050.0)', got.rawBody.replace('"collectedMinor":125050', '"collectedMinor":125050.0')],
];
for (const [how, body] of reserialised) {
  check(`re-serialising the body — ${how} — does NOT verify`, !verifyFromDocs(SECRET, got.signature, body));
}
check(
  'the reason is not JavaScript: parse + stringify round-trips byte-identically here',
  JSON.stringify(parsed) === got.rawBody,
);
check(
  'a tampered body is rejected',
  !verifyFromDocs(SECRET, got.signature, got.rawBody.replace('125050', '1')),
);
check(
  'the wrong secret is rejected',
  !verifyFromDocs('whsec_wrong_secret', got.signature, got.rawBody),
);
check(
  'a single flipped hex digit is rejected',
  !verifyFromDocs(
    SECRET,
    String(got.signature).replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')),
    got.rawBody,
  ),
);
check(
  'a stale timestamp outside the 5-minute window is rejected',
  !verifyFromDocs(SECRET, got.signature, got.rawBody, Math.trunc(Date.now() / 1000) + 3600),
);
check(
  'a timestamp just inside the window is still accepted (the boundary is not off by one)',
  verifyFromDocs(SECRET, got.signature, got.rawBody, Math.trunc(Date.now() / 1000) + 299),
);
check('a missing header is rejected', !verifyFromDocs(SECRET, undefined, got.rawBody));
check(
  'a malformed header is rejected, not thrown on',
  !verifyFromDocs(SECRET, 'garbage', got.rawBody),
);
check(
  'a header with no v1 component is rejected',
  !verifyFromDocs(SECRET, String(got.signature).replace(/,v1=.*/, ''), got.rawBody),
);

// ─── 4. the platform agrees with the stranger ───────────────────────────────
// If these two ever diverge, the docs describe a signature we do not send — which is worse than a
// wrong signature, because a merchant's correct implementation stops working.
const { verifySignature } = await import('../dist/modules/merchant/rules/webhook.js');
check(
  'our own verifier agrees with the stranger on the real delivery',
  verifySignature(SECRET, got.signature, got.rawBody),
);
check(
  'our own verifier agrees on a tampered body too',
  !verifySignature(SECRET, got.signature, `${got.rawBody} `),
);
check(
  'the signature is deterministic: the same bytes sign to the same hex',
  createHmac('sha256', SECRET)
    .update(
      `${/^t=(\d+)/.exec(String(got.signature))[1]}.${got.rawBody}`,
      'utf8',
    )
    .digest('hex') === /v1=([0-9a-f]+)/.exec(String(got.signature))[1],
);

server.close();
console.log(
  `\nstage 6b signature: ${failures === 0 ? 'all assertions ok' : `${failures} FAILED`}`,
);
process.exit(failures === 0 ? 0 : 1);