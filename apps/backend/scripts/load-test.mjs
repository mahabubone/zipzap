/**
 * Load test (Phase 6 rung 5) — docs/operations/demo-scenarios.md.
 *
 *   pnpm --filter @zipzap/backend test:load [--shipments=200] [--api-key=ak_x.secret]
 *
 * Measures what docs/operations/performance.md lists as hypotheses:
 *
 *   RPS · latency p50/p95/p99 · DB utilisation · queue lag · event processing rate
 *
 * Phases against a live stack (spawned if not already running):
 *
 *   warmup     a short unmeasured create burst, then wait for the outbox backlog
 *              to drain — measuring API latency while 8k events pour through the
 *              pipeline measures the backlog, not the endpoint.
 *   tracking   GET /track/:code — paced under the product's own public limit
 *              (100/min/IP): the limiter is the ceiling, and latency of the
 *              served requests is the number that matters.
 *   create     POST /v1/shipments, concurrency under the merchant tier (600/min),
 *              with db_pool_active sampled every second while it runs.
 *   simulate   fixture shipments through the real simulation engine (pickups,
 *              sorting, transit, delivery, COD — returns on every fifth parcel):
 *              this is what fills the event pipeline, sampled while it runs.
 *   settle     create → approve → initiate → confirm with the in-process
 *              MockPaymentProvider for every merchant that collected COD.
 *
 * Each process's counters are read from THAT process's /metrics — the worker
 * owns event/queue counters (METRICS_PORT), the publisher owns outbox publish
 * counters (PUBLISHER_METRICS_PORT); the API port only carries HTTP/DB/outbox
 * gauges. The report prints measured percentiles next to the performance.md
 * targets. Exit code is 1 only for operational failure — missing a target is a
 * measurement, not an error.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
function arg(name) {
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
}

const backendDir = fileURLToPath(new URL('..', import.meta.url));
const dist = (p) => fileURLToPath(new URL(`../dist/${p}`, import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
const METRICS_PORT = Number(process.env.METRICS_PORT ?? 9090);
const PUB_METRICS_PORT = Number(process.env.PUBLISHER_METRICS_PORT ?? 9091);
const API = `http://localhost:${PORT}`;
const WORKER_METRICS = `http://localhost:${METRICS_PORT}/metrics`;
const PUBLISHER_METRICS = `http://localhost:${PUB_METRICS_PORT}/metrics`;

const SIM_SHIPMENTS = Number(arg('shipments') ?? 200);
const CREATE_SECONDS = Number(arg('create-seconds') ?? 10);
const WARMUP_CREATES = 20;
const OUTBOX_BACKLOG_OK = 100;
const TRACK_WORKERS = 2;
const TRACK_PER_WORKER = 45; // 90 requests paced over 60s: under 100/min/IP, all served
const CREATE_WORKERS = 8;
const FETCH_TIMEOUT = 5_000;

const spawned = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(message) {
  console.error(`error: ${message}`);
  teardown();
  process.exit(1);
}

function teardown() {
  for (const child of spawned) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

async function fetchOk(url, timeoutMs = 2_000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fetchOk(url)) return;
    await sleep(500);
  }
  fail(`${label} did not come up at ${url} within ${Math.round(timeoutMs / 1000)}s`);
}

function spawnEntrypoint(file) {
  // stdout/stderr to a log file: stdio:'ignore' once hid a publisher crash that
  // made the whole publish column read zero with no way to see why.
  const logPath = `/tmp/zipzap-load-${file.replace('.js', '')}.log`;
  const out = openSync(logPath, 'a');
  const child = spawn(process.execPath, [dist(file)], {
    cwd: backendDir,
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  child.unref();
  spawned.push(child);
  console.log(`  → ${file} pid ${child.pid} (log: ${logPath})`);
  return child;
}

async function ensureStack() {
  // Each entrypoint independently: the API may already be running while the
  // worker and publisher (which the event phases depend on) are not.
  const checks = [
    { label: 'api', url: `${API}/metrics`, file: 'main.js' },
    { label: 'worker', url: WORKER_METRICS, file: 'worker.js' },
    { label: 'publisher', url: PUBLISHER_METRICS, file: 'publisher.js' },
  ];
  for (const check of checks) {
    if (await fetchOk(check.url)) {
      console.log(`${check.label}: already running at ${check.url}`);
    } else {
      console.log(`${check.label}: not reachable — spawning ${check.file}…`);
      spawnEntrypoint(check.file);
      await waitFor(check.url, `${check.label} metrics`);
    }
  }
}

async function ensureApiKey() {
  const provided = process.env.ZIPZAP_API_KEY ?? arg('api-key');
  if (provided) return provided;

  console.log('api-key: none given — seeding a credential…');
  const out = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [dist('database/cli.js'), 'seed'], {
      cwd: backendDir,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`seed failed: ${stderr}`)),
    );
  });
  const keyId = out.match(/key_id\s+:\s+(\S+)/)?.[1];
  const secret = out.match(/secret\s+:\s+(\S+)/)?.[1];
  if (!keyId || !secret) fail('could not parse a credential from the seed output.');
  return `${keyId}.${secret}`;
}

let pgClient;
async function query(sql, params = []) {
  if (!pgClient) {
    const { default: pg } = await import('pg');
    pgClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await pgClient.connect();
  }
  const result = await pgClient.query(sql, params);
  return result.rows;
}

function parseMetrics(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const sp = line.lastIndexOf(' ');
    if (sp < 0) continue;
    map.set(line.slice(0, sp), Number(line.slice(sp + 1)));
  }
  return map;
}

async function scrape(url = `${API}/metrics`) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return parseMetrics(await r.text());
  } catch {
    return new Map();
  }
}

function sumMetric(map, name) {
  let sum = 0;
  // A name that already carries label filters (`x{a="b"}`) prefixes directly;
  // a bare name must still be followed by `{` to not match `x_total_foo`.
  const filter = name.includes('{') ? name : `${name}{`;
  for (const [key, value] of map) {
    if (key === name || key.startsWith(filter)) sum += value;
  }
  return sum;
}

function maxMetric(map, name) {
  let max = 0;
  for (const [key, value] of map) {
    if ((key === name || key.startsWith(`${name}{`)) && value > max) max = value;
  }
  return max;
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return NaN;
  const idx = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return sortedAsc[idx];
}

function makeRecorder() {
  const latencies = [];
  const statuses = new Map();
  return {
    record(status, ms) {
      latencies.push(ms);
      statuses.set(status, (statuses.get(status) ?? 0) + 1);
    },
    summary() {
      const sorted = [...latencies].sort((a, b) => a - b);
      const errors = [...statuses]
        .filter(([s]) => s < 200 || s >= 300)
        .reduce((n, [, c]) => n + c, 0);
      return {
        requests: latencies.length,
        errors,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        rps: 0, // filled by the caller, which owns the elapsed clock
      };
    },
  };
}

function shipmentPayload() {
  return {
    senderName: 'Load Test',
    senderPhone: '+8801711111111',
    senderAddress: 'Load Warehouse, Dhaka',
    recipientName: 'Load Customer',
    recipientPhone: `+88018${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    recipientAddress: 'Load Destination, Dhaka',
    parcelWeightGrams: 200 + (Date.now() % 3000),
    parcelDescription: 'load test parcel',
    zone: 'dhaka-metro',
    remoteArea: false,
    fragile: false,

    codAmountMinor: (10 + (Date.now() % 40)) * 1_000,
    codCurrency: 'BDT',
  };
}

async function postShipment(apiKey) {
  const r = await fetch(`${API}/v1/shipments`, {
    method: 'POST',
    headers: {
      Authorization: `ApiKey ${apiKey}`,
      'Idempotency-Key': `load-${randomUUID()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(shipmentPayload()),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  await r.arrayBuffer();
  return r.status;
}

// ----------------------------------------------------------------------------

async function warmupPhase(apiKey) {
  console.log(`warmup: ${WARMUP_CREATES} unmeasured creates + waiting for the outbox to drain…`);
  for (let i = 0; i < WARMUP_CREATES; i++) {
    await postShipment(apiKey);
  }

  // Backlog from earlier runs drains through the real publisher/consumers. Latency
  // measured against a backlog measures the backlog.
  const deadline = Date.now() + 120_000;
  let pending = sumMetric(await scrape(), 'zipzap_outbox_pending_total');
  while (pending > OUTBOX_BACKLOG_OK && Date.now() < deadline) {
    console.log(`  outbox_pending ${pending} — draining…`);
    await sleep(3_000);
    pending = sumMetric(await scrape(), 'zipzap_outbox_pending_total');
  }
  if (pending > OUTBOX_BACKLOG_OK) {
    console.log(`  warning: outbox still at ${pending} after 120s — measuring anyway`);
  } else {
    console.log(`  outbox drained to ${pending}`);
  }
}

async function trackingPhase() {
  const rows = await query(
    `SELECT tracking_code FROM (SELECT DISTINCT tracking_code FROM tracking.public_timeline) t
      ORDER BY random() LIMIT 500`,
  );
  if (rows.length === 0) {
    fail('no trackable shipments — run: pnpm db:seed --profile=load');
  }
  const codes = rows.map((r) => r.tracking_code);
  const recorder = makeRecorder();
  const paceMs = Math.ceil((60_000 * TRACK_WORKERS) / (TRACK_WORKERS * TRACK_PER_WORKER));

  console.log(`tracking: ${TRACK_WORKERS * TRACK_PER_WORKER} requests paced over ~60s…`);
  const started = Date.now();
  await Promise.all(
    Array.from({ length: TRACK_WORKERS }, async (_, worker) => {
      for (let i = 0; i < TRACK_PER_WORKER; i++) {
        const code = codes[(worker * TRACK_PER_WORKER + i) % codes.length];
        const t = performance.now();
        try {
          const r = await fetch(`${API}/track/${code}`, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT),
          });
          recorder.record(r.status, performance.now() - t);
          await r.arrayBuffer();
        } catch {
          recorder.record(0, performance.now() - t);
        }
        await sleep(paceMs);
      }
    }),
  );
  const elapsed = (Date.now() - started) / 1_000;
  const summary = recorder.summary();
  summary.rps = summary.requests / elapsed;
  return { name: 'tracking', elapsed, ...summary };
}

async function createPhase(apiKey) {
  const recorder = makeRecorder();
  const deadline = Date.now() + CREATE_SECONDS * 1_000;
  let poolMax = 0;
  const sampler = setInterval(() => {
    scrape().then((s) => {
      poolMax = Math.max(poolMax, maxMetric(s, 'zipzap_db_pool_active_connections'));
    });
  }, 1_000);

  console.log(`create: ${CREATE_WORKERS} workers for ${CREATE_SECONDS}s…`);
  const started = Date.now();
  await Promise.all(
    Array.from({ length: CREATE_WORKERS }, async () => {
      while (Date.now() < deadline) {
        const t = performance.now();
        try {
          const status = await postShipment(apiKey);
          recorder.record(status, performance.now() - t);
        } catch {
          recorder.record(0, performance.now() - t);
        }
      }
    }),
  );
  clearInterval(sampler);
  const elapsed = (Date.now() - started) / 1_000;
  const summary = recorder.summary();
  summary.rps = summary.requests / elapsed;
  return { name: 'create', elapsed, poolMax, ...summary };
}

async function simulationPhase() {
  const rows = await query(
    `SELECT id, tracking_code FROM shipment.shipments
      WHERE status = 'CREATED' AND merchant_reference LIKE 'fixture-%'
      ORDER BY created_at DESC LIMIT $1`,
    [SIM_SHIPMENTS],
  );
  if (rows.length === 0) {
    fail('no fixture shipments — run: pnpm db:seed --profile=load');
  }

  const { runSimulation } = await import('../dist/simulate.js');
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../dist/app.module.js');

  console.log(`simulate: ${rows.length} fixture shipments through the real engine…`);
  const app = await NestFactory.createApplicationContext(AppModule);
  const snapshots = [];
  const started = Date.now();
  let delivered = 0;
  let returned = 0;
  let failed = 0;

  try {
    for (const [i, row] of rows.entries()) {
      const scenario = i % 5 === 0 ? 'returned' : 'delivered';
      try {
        const result = await runSimulation(row.tracking_code, scenario, app);
        if (result.finalStatus === 'RETURNED') returned += 1;
        else delivered += 1;
      } catch (error) {
        failed += 1;
        console.error(`  sim failed for ${row.tracking_code}: ${error.message}`);
      }
      if (i % 20 === 19) snapshots.push(await scrape());
    }
  } finally {
    await app.close();
  }
  snapshots.push(await scrape());
  const elapsed = (Date.now() - started) / 1_000;

  return {
    name: 'simulate',
    elapsed,
    delivered,
    returned,
    failed,
    shipmentIds: rows.map((r) => r.id),
    snapshots,
  };
}

async function settlementPhase(shipmentIds) {
  if (shipmentIds.length === 0) return { name: 'settle', settled: 0, failed: 0 };

  const merchants = await query(
    `SELECT DISTINCT merchant_id FROM cod.records
      WHERE status = 'COD_COLLECTED' AND shipment_id = ANY($1::uuid[])`,
    [shipmentIds],
  );
  if (merchants.length === 0) {
    return { name: 'settle', settled: 0, failed: 0, note: 'no COD collected in this run' };
  }

  const { connectModuleDataSource } = await import('../dist/database/module-connection.js');
  const { LedgerEntryEntity } = await import('../dist/modules/finance/ledger-entry.entity.js');
  const { SettlementEntity } = await import('../dist/modules/finance/settlement.entity.js');
  const { FinanceRepository } = await import('../dist/modules/finance/finance.repository.js');
  const { CreateSettlementService } =
    await import('../dist/modules/finance/create-settlement.service.js');
  const { ApproveSettlementService } =
    await import('../dist/modules/finance/approve-settlement.service.js');
  const { InitiateSettlementPaymentService } =
    await import('../dist/modules/finance/initiate-settlement-payment.service.js');
  const { ConfirmSettlementPaymentService } =
    await import('../dist/modules/finance/confirm-settlement-payment.service.js');
  const { MockPaymentProvider } =
    await import('../dist/modules/finance/provider/mock-payment.provider.js');

  console.log(`settle: money chain for ${merchants.length} merchant(s)…`);
  const financeDb = await connectModuleDataSource('finance', [LedgerEntryEntity, SettlementEntity]);
  const repo = new FinanceRepository();
  const payments = new MockPaymentProvider();
  const create = new CreateSettlementService(financeDb, repo);
  const approve = new ApproveSettlementService(financeDb, repo);
  const initiate = new InitiateSettlementPaymentService(financeDb, repo, payments);
  const confirm = new ConfirmSettlementPaymentService(financeDb, repo, payments);

  const started = Date.now();
  let settled = 0;
  let failed = 0;
  try {
    for (const row of merchants) {
      try {
        const created = await create.execute({ merchantId: row.merchant_id, actorId: null });
        await approve.execute({
          settlementId: created.id,
          approverId: randomUUID(),
          idempotencyKey: `load-${randomUUID()}`,
        });
        const init = await initiate.execute({
          settlementId: created.id,
          idempotencyKey: `load-${randomUUID()}`,
        });
        payments.settle(init.result.paymentReference, 'succeeded');
        await confirm.execute({
          settlementId: created.id,
          idempotencyKey: `load-${randomUUID()}`,
        });
        settled += 1;
      } catch (error) {
        failed += 1;
        console.error(`  settle failed for ${row.merchant_id}: ${error.message}`);
      }
    }
  } finally {
    await financeDb.destroy();
  }
  return {
    name: 'settle',
    elapsed: (Date.now() - started) / 1_000,
    settled,
    failed,
  };
}

function ms(value) {
  return Number.isFinite(value) ? `${value.toFixed(0)}ms` : 'n/a';
}

function report(phases, pipeline) {
  console.log('');
  console.log('=== load test report ===');
  console.log('');
  console.log('phase      requests  errors  RPS    p50     p95     p99');
  for (const phase of phases) {
    if (phase.requests !== undefined) {
      console.log(
        `${phase.name.padEnd(10)} ${String(phase.requests).padStart(8)}  ` +
          `${String(phase.errors).padStart(6)}  ${phase.rps.toFixed(1).padStart(5)}  ` +
          `${ms(phase.p50).padStart(6)}  ${ms(phase.p95).padStart(6)}  ${ms(phase.p99).padStart(6)}`,
      );
    }
  }
  const sim = phases.find((p) => p.name === 'simulate');
  const settle = phases.find((p) => p.name === 'settle');
  if (sim) {
    const ok = sim.delivered + sim.returned;
    console.log(
      `simulate  ${String(ok + sim.failed).padStart(8)}  ${String(sim.failed).padStart(6)}  ` +
        `${(ok / sim.elapsed).toFixed(1).padStart(5)} ship/s  ` +
        `(${sim.delivered} delivered, ${sim.returned} returned)`,
    );
  }
  if (settle) {
    console.log(
      `settle    ${String(settle.settled + settle.failed).padStart(8)}  ` +
        `${String(settle.failed).padStart(6)}  settled${settle.note ? ` (${settle.note})` : ''}`,
    );
  }

  console.log('');
  console.log('pipeline:');
  console.log(
    `  outbox_pending  max ${pipeline.outboxMax} (start ${pipeline.outboxStart}, end ${pipeline.outboxEnd})`,
  );
  console.log(
    `  outbox_publish  ${pipeline.published} published, ${pipeline.publishFailed} failed`,
  );
  console.log(
    `  event rate      ${pipeline.eventsProcessed} events consumed in ${pipeline.eventSeconds}s = ${pipeline.eventRate.toFixed(1)}/s`,
  );
  console.log(`  queue_depth     ${pipeline.queueNote}`);
  console.log(`  db_pool_active  max ${pipeline.poolMax} active connections`);

  console.log('');
  console.log('targets (docs/operations/performance.md):');
  const track = phases.find((p) => p.name === 'tracking');
  const create = phases.find((p) => p.name === 'create');
  if (track) {
    const ok = track.p95 < 200;
    console.log(
      `  GET /track/:code   p95 < 200ms  ${ms(track.p95).padStart(7)}  ${ok ? 'PASS' : 'MISS'}`,
    );
  }
  if (create) {
    const ok = create.p95 < 300;
    console.log(
      `  POST /v1/shipments p95 < 300ms  ${ms(create.p95).padStart(7)}  ${ok ? 'PASS' : 'MISS'}`,
    );
  }
}

async function main() {
  await ensureStack();
  const apiKey = await ensureApiKey();

  // Warm the paths before clocks start.
  await query(`SELECT 1`);
  const apiBaseline = await scrape();
  await warmupPhase(apiKey);
  const workerBefore = await scrape(WORKER_METRICS);
  const publisherBefore = await scrape(PUBLISHER_METRICS);
  const workerBeforeAt = Date.now();

  const phases = [];
  const trackPhase = await trackingPhase();
  phases.push(trackPhase);
  const create = await createPhase(apiKey);
  phases.push(create);

  const sim = await simulationPhase();
  const apiAfter = await scrape();
  const workerAfter = await scrape(WORKER_METRICS);
  const publisherAfter = await scrape(PUBLISHER_METRICS);
  const eventSeconds = (Date.now() - workerBeforeAt) / 1_000;

  const eventsProcessed =
    sumMetric(workerAfter, 'zipzap_event_consumed_total') -
    sumMetric(workerBefore, 'zipzap_event_consumed_total');
  const queueKeys = [...workerAfter.keys()].filter((k) => k.startsWith('zipzap_queue_depth{'));
  const queueNote =
    queueKeys.length === 0
      ? 'no queue samples (queues empty or worker metrics unreachable)'
      : queueKeys
          .map((k) => {
            const queue = k.match(/queue="([^"]+)"/)?.[1] ?? '?';
            return `${queue}: ${workerAfter.get(k)}`;
          })
          .join(', ');

  const pipeline = {
    outboxStart: sumMetric(apiBaseline, 'zipzap_outbox_pending_total'),
    outboxEnd: sumMetric(apiAfter, 'zipzap_outbox_pending_total'),
    outboxMax: Math.max(
      sumMetric(apiBaseline, 'zipzap_outbox_pending_total'),
      sumMetric(apiAfter, 'zipzap_outbox_pending_total'),
      ...sim.snapshots.map((s) => sumMetric(s, 'zipzap_outbox_pending_total')),
    ),
    published:
      sumMetric(publisherAfter, 'zipzap_outbox_publish_total{outcome="published"') -
      sumMetric(publisherBefore, 'zipzap_outbox_publish_total{outcome="published"'),
    publishFailed:
      sumMetric(publisherAfter, 'zipzap_outbox_publish_total{outcome="failed"') -
      sumMetric(publisherBefore, 'zipzap_outbox_publish_total{outcome="failed"'),
    eventsProcessed,
    eventSeconds,
    eventRate: eventSeconds > 0 ? eventsProcessed / eventSeconds : 0,
    queueNote,
    poolMax: create.poolMax ?? 0,
  };

  const settle = await settlementPhase(sim.shipmentIds);
  phases.push(sim);
  phases.push(settle);

  report(phases, pipeline);

  await pgClient?.end();
  teardown();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  teardown();
  process.exit(1);
});
