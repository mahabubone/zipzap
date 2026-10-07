# Performance

Engineering targets, not marketing promises. Every number here is a **starting hypothesis** to be
replaced by measured values from load tests.

## Targets

| Operation                  | Target      |
| -------------------------- | ----------- |
| `GET /track/:trackingCode` | p95 < 200ms |
| `POST /v1/shipments`       | p95 < 300ms |
| Simple single-table query  | p95 < 100ms |
| Dashboard list query       | p95 < 500ms |
| Async event propagation    | seconds     |
| Outbox → NATS              | < 1s        |
| Event → webhook delivered  | < 30s       |

Two numbers deserve explanation.

**Shipment creation is slower than tracking** because it writes four rows across three modules in
one transaction and must wait for the commit. That is the correct cost of a durable, auditable
event — not something to optimise away by publishing outside the transaction.

**Event propagation is seconds, not milliseconds.** Nothing in the read path depends on it, and
optimising it would mean moving to a broker that cannot be transactional with Postgres. The
target is "promptly", with an alert if it stops being true.

## Measure

[Load test](./demo-scenarios.md#load-testing) these:

```
shipment creation · tracking · merchant dashboard · bulk imports
webhook processing · tracking event ingestion · settlement approval
```

Record:

```
RPS · latency p50/p95/p99 · DB utilisation · queue lag · event processing rate
          connection pool saturation · lock waits
```

p99 is where the complaints live. A p95 of 200ms with a p99 of 4s means one customer in a
hundred is having a bad afternoon, and they are the one who writes to support.

## What actually limits throughput

In rough order of likelihood:

1. **Connection pool size.** The most common ceiling by a wide margin. Raising it past what the
   database can serve moves the queue from the app to Postgres, where it is harder to see.
2. **Missing index on a list endpoint.** A filter combined with `ORDER BY created_at` needs an
   index matching both, or the database sorts the whole table.
3. **N+1 queries.** A list endpoint lazily loading per row turns 1 query into 101.
4. **Transaction scope.** A long transaction holds locks and blocks everything behind it. Chunk
   bulk work.
5. **The database itself.** Last on the list, and where it usually turns out to be.

Check the first before optimising the fifth.

## SLOs

|                                 | Target         |
| ------------------------------- | -------------- |
| API availability                | 99.9% monthly  |
| Tracking availability           | 99.95% monthly |
| Event propagation p99           | < 60s          |
| Webhook delivery, first attempt | > 95%          |

99.9% is 43 minutes a month. It is a number that forces a conversation about what happens during
those 43 minutes, which is the actual point of writing one down.

## Measured — local load test

`pnpm db:seed --profile=load` (10,500 fixture shipments) then
`pnpm --filter @zipzap/backend test:load`, 2026-10-07, single dev machine,
docker-compose PostgreSQL 18 / Redis / NATS on localhost, Node 24:

| Operation                  | Measured                                                               | Target      | Result |
| -------------------------- | ---------------------------------------------------------------------- | ----------- | ------ |
| `GET /track/:trackingCode` | p50 4ms · p95 9ms · p99 25ms                                           | p95 < 200ms | PASS   |
| `POST /v1/shipments`       | p50 194ms · p95 262ms · p99 280ms, 39.7 RPS, 0 errors at concurrency 8 | p95 < 300ms | PASS   |

Pipeline during the run: 56.6 events/s consumed · 3,102 outbox rows published, 0 failed ·
DB pool peaked at 2 of 10 connections · 200/200 simulated shipments and 37/37 settlements
completed. Tracking is paced to the public tier (100/min/IP) — the limiter is the ceiling,
so its RPS is a product choice, not a bottleneck.

**The load test's first finding was the API key verifier.** `verifySecret` ran
`scryptSync` (~72ms of blocked event loop) on every authenticated request: eight
concurrent creates serialised to ~800ms p95 with the database idle, the event loop
otherwise free, and every wave of requests completing in lockstep — the endpoint was
measuring scrypt, not the database. The fix: async `scrypt` on the libuv threadpool
plus `UV_THREADPOOL_SIZE=8` (one verify slot per concurrent request, set in `.env`).
p95 went 1194ms → 262ms. The queue-lag number that remains high — notifications
backing up while the SMS provider fake is down — is the load test working as intended:
a symptom with a cause you can read off the dashboard.

## What is not measured

Nothing here is measured against a production system, because there is no production system yet.
The local numbers above replace the hypotheses only for a single-machine dev stack; a real
deployment must run the same load test and record its own.

---

Related: [observability.md](observability.md) · [deployment.md](deployment.md) ·
[reliability.md](reliability.md) · [demo-scenarios.md](demo-scenarios.md)
