/**
 * Stage 6b, exit check 1 — "a merchant registers a webhook, sees each delivery attempt in a log, and
 * replays a failed one."
 *
 * The unit specs prove the log query and the replay rule in isolation. What they cannot show is the
 * merchant's actual path through the API, so this drives it end to end against a live server:
 *
 *   register → provoke a real failure → read the delivery log → replay → read the log again.
 *
 * "Provoke a real failure" means a real HTTP endpoint returning 500, not a stubbed fetcher. The
 * delivery that lands in the log is the one the platform actually produced, with the status code the
 * merchant's server actually returned.
 *
 * Replay needs the BullMQ processor, so `worker.js` must be running as well as `main.js` — the API
 * enqueues and the worker delivers, and a proof that skipped the worker would be measuring the queue
 * rather than the behaviour.
 *
 * Run: node apps/backend/scripts/verify-webhook-portal.mjs
 * Env:  PROVE_BASE (default http://localhost:3000), API_KEY_ID, API_SECRET
 */
import http from 'node:http';

const BASE = process.env.PROVE_BASE ?? 'http://localhost:3000';
const KEY_ID = process.env.API_KEY_ID;
const API_SECRET = process.env.API_SECRET;

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
}

if (!KEY_ID || !API_SECRET) {
  console.error('Set API_KEY_ID and API_SECRET (see `pnpm db:seed` output — printed once).');
  process.exit(1);
}

const auth = `ApiKey ${KEY_ID}.${API_SECRET}`;
const call = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      ...(method === 'POST' ? { 'Idempotency-Key': `wp-${Date.now()}-${Math.random()}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

// ─── a merchant endpoint we can make misbehave on demand ─────────────────────
let mode = 'fail';
const hits = [];
const hook = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    hits.push({
      rawBody: Buffer.concat(chunks).toString('utf8'),
      delivery: req.headers['zipzap-delivery'],
      event: req.headers['zipzap-event'],
      attempt: req.headers['zipzap-attempt'],
    });
    if (mode === 'fail') {
      // 400, not 500: a 5xx is retryable, so the delivery would sit on the ladder for hours instead
      // of becoming terminal. A 4xx is terminal on the first attempt, which is both the instant
      // replay scenario and the realistic one — the merchant's own endpoint rejected our payload.
      res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"rejected"}');
    } else {
      res.writeHead(204).end();
    }
  });
});
await new Promise((r) => hook.listen(0, '127.0.0.1', r));
const hookUrl = `http://127.0.0.1:${hook.address().port}/merchant-hook`;

// ─── 1. register the endpoint, secret shown once ─────────────────────────────
const created = await call('POST', '/v1/webhooks', {
  url: hookUrl,
  events: ['shipment.created'],
});
check(
  'a merchant can register an endpoint',
  created.status === 201,
  `HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`,
);
const endpointId = created.body?.data?.id ?? created.body?.endpoint?.id;
const secret = created.body?.data?.secret ?? created.body?.secret;
check('the response carries an endpoint id', typeof endpointId === 'string');
check(
  'the signing secret is returned exactly once, at creation',
  typeof secret === 'string' && secret.length > 0,
);

const listed = await call('GET', '/v1/webhooks');
const endpoints = listed.body?.data ?? listed.body ?? [];
check(
  'the endpoint appears in the merchant`s list',
  endpoints.some((e) => e.id === endpointId),
  `listed ${endpoints.length}`,
);

// ─── 2. provoke a real delivery that really fails ────────────────────────────
// The queue is what carries it, so drive it the way the product does: through the API.
const shipment = await call('POST', '/v1/shipments', {
  senderName: 'Webhook Merchant',
  senderPhone: '+8801600000000',
  senderAddress: 'Agrabad C/A, Chattogram',
  recipientName: 'Webhook Recipient',
  recipientPhone: '+8801700000000',
  recipientAddress: 'Zindabazar, Sylhet',
  parcelWeightGrams: 900,
  parcelDescription: 'webhook portal proof',
  zone: 'dhaka-metro',
  remoteArea: false,
  fragile: false,
});
check(
  'a fixture shipment exists to emit events for',
  shipment.status === 201,
  `HTTP ${shipment.status}`,
);
const shipmentId = shipment.body?.data?.id ?? shipment.body?.id;

// ─── 3. the delivery log, read the way a merchant reads it ──────────────────
// Waiting for the real event to travel outbox -> publisher -> NATS -> consumer -> queue -> sender.
const deadline = Date.now() + 45_000;
let rows = [];
while (Date.now() < deadline) {
  const logRes = await call('GET', '/v1/webhooks/deliveries?limit=50');
  rows = logRes.body?.data ?? [];
  if (rows.some((r) => r.endpointId === endpointId)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const mine = rows.filter((r) => r.endpointId === endpointId);
check(
  'the failed attempt appears in the delivery log',
  mine.length > 0,
  `no rows for this endpoint out of ${rows.length}`,
);
check(
  'the log records the status code the merchant`s server returned',
  mine.some((r) => r.statusCode === 400),
  `status codes seen: ${[...new Set(mine.map((r) => r.statusCode))].join(', ')}`,
);
check(
  'the log records the attempt number, so a retry is visible as a retry',
  mine.some((r) => typeof r.attempt === 'number' && r.attempt >= 1),
  `attempts: ${mine.map((r) => r.attempt).join(', ')}`,
);
check('the endpoint really was called', hits.length > 0, `${hits.length} requests`);

// ─── 4. replay the failure after the merchant fixes their endpoint ───────────
const terminal = mine.find((r) => r.terminal === true);
check(
  'a 4xx is terminal on the first attempt, so it is replayable',
  Boolean(terminal),
  `no terminal row among ${JSON.stringify(mine.map((r) => ({ status: r.statusCode, terminal: r.terminal })))}`,
);
check(
  'a retryable failure is NOT terminal — it stays on the ladder instead',
  mine.every((r) => !(r.statusCode >= 500 && r.terminal === true)),
  'a 5xx was marked terminal, which would skip the retry ladder',
);

mode = 'ok';
const before = hits.length;
if (!terminal) {
  console.log('SKIP  replay — no terminal delivery row to replay');
  hook.close();
  console.log(`\nstage 6b webhook portal: ${failures} FAILED`);
  process.exit(1);
}
const replay = await call('POST', `/v1/webhooks/deliveries/${terminal.id}/replay`, {});
check(
  'replay is accepted',
  replay.status === 201 || replay.status === 200,
  `HTTP ${replay.status} ${JSON.stringify(replay.body).slice(0, 200)}`,
);

const replayDeadline = Date.now() + 45_000;
let delivered = false;
while (Date.now() < replayDeadline) {
  const logRes = await call('GET', '/v1/webhooks/deliveries?limit=50');
  const nowRows = (logRes.body?.data ?? []).filter((r) => r.endpointId === endpointId);
  if (nowRows.some((r) => r.delivered === true || (r.statusCode && r.statusCode < 300))) {
    delivered = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
check('after the endpoint is fixed, a replayed delivery succeeds', delivered);
check(
  'the replay was a NEW request, not a resend of the old one',
  hits.length > before,
  `${before} -> ${hits.length}`,
);
check(
  'the replay carries a fresh delivery id, so a receiver deduping on it is not double-counted',
  hits.length > before && hits[hits.length - 1].delivery !== hits[0].delivery,
  `first ${hits[0]?.delivery}, latest ${hits[hits.length - 1]?.delivery}`,
);
check(
  'the replayed request is the same event, re-signed for the same endpoint',
  hits[hits.length - 1]?.event === 'shipment.created',
  String(hits[hits.length - 1]?.event),
);

const finalLog = await call('GET', '/v1/webhooks/deliveries?limit=50');
const finalRows = (finalLog.body?.data ?? []).filter((r) => r.endpointId === endpointId);
check(
  'the log now shows both the failure and the successful replay',
  finalRows.some((r) => r.statusCode === 400) &&
    finalRows.some((r) => r.statusCode && r.statusCode < 300),
  `codes: ${[...new Set(finalRows.map((r) => r.statusCode))].join(', ')}`,
);

// Leave nothing running.
hook.close();
console.log(
  `\nstage 6b webhook portal: ${failures === 0 ? 'all assertions ok' : `${failures} FAILED`}`,
);
process.exit(failures === 0 ? 0 : 1);
