# ROADMAP.md

Build order for ZipZap. Derived from the product spec; [`docs/product/roadmap.md`](docs/product/roadmap.md)
covers the same phases from the product side.

Each phase has an **exit gate** — a check you can run, not a feeling. A phase is not done until
its gate passes.

---

## The spine: one shipment, end to end

Everything in this roadmap exists to make this story demonstrable:

```
merchant creates order → pricing → pickup requested → rider assigned → rider picks up
→ origin hub scan → dispatch → destination hub → rider assigned → out for delivery
→ customer receives parcel → COD collected → shipment delivered → merchant webhook
→ COD reconciliation → settlement
```

The same event must be visible in five places: merchant dashboard, operations console, rider
app, customer tracking page, financial dashboard. That is the portfolio demo, and it is the
acceptance test for the architecture. If the story does not run through all five, the phase
that broke it is not done.

---

## Phase 0 — Foundation ✅ in progress

Repo, documentation, ADRs, local infrastructure, CI.

- pnpm + turbo monorepo; NestJS 12 backend with three entrypoints (api / worker / publisher)
- PostgreSQL + PostGIS, Redis, NATS JetStream under `infra/compose`
- Outbox table, error envelope, `Money` type, idempotency middleware — the four primitives
  every module will need, built once
- 18 domain docs, 14 ADRs, CI running lint + typecheck + test

**Gate:** `pnpm i && docker compose -f infra/compose/docker-compose.yml up -d && pnpm db:migrate`
from a clean clone, then all three processes boot and `/healthz` returns 200.

---

## Phase 1 — Foundation domain

Identity, merchant, shipment, tracking.

- Auth: sessions, API key + secret (hashed, rotatable, revocable), roles → permissions
- Merchant lifecycle APPLIED → UNDER_REVIEW → VERIFIED → ACTIVE → SUSPENDED
- Shipment aggregate + validated state machine (`DRAFT` → `CREATED`)
- Immutable tracking events; public `/track/:trackingCode` read model
- Outbox wired end to end: mutation → outbox row → publisher → NATS → consumer

**Gate:** create a shipment via API with an `Idempotency-Key`, replay the same key, get the
original response and one row only. Kill the publisher, mutate, restart it, event lands exactly
once.

---

## Phase 2 — Logistics

Pickup, rider, hub, manifest, network, delivery, returns.

- Pickup request → batching → rider assignment (deterministic and explainable, not "optimal")
- Hub scan in / sort / dispatch; manifest sealing and reconciliation
- PostGIS: Bangladesh hierarchy (division → district → upazila → union → ward), service areas,
  serviceability check before a shipment may be created
- Delivery attempts with structured failure reasons, OTP + photo proof of delivery
- Return flow referencing the original shipment

**Gate:** the flagship story runs to `DELIVERED` in a seeded network. The failure story runs
too: refused → retry → refused → return → merchant receives it.

---

## Phase 3 — Finance

COD, ledger, settlement.

- COD lifecycle `COD_EXPECTED` → `COLLECTED` → `RECONCILED` → `PAYABLE` → settled
- Double-entry style ledger, append-only, corrections as compensating rows
- Settlement batch → approval → payment initiation → confirmation → settled
- Merchant balance derived from the ledger, never a mutable counter
- Payment provider behind one interface; mock implementation first

**Gate:** the ledger balances to the settlement total. Deliberately corrupt one COD collection;
reconciliation raises an exception, and the compensating entry restores the balance with both
original rows preserved.

---

## Phase 4 — Platform

Public API v1, webhooks, bulk import, notifications, risk signals, developer portal.

- Full `/v1` surface, OpenAPI as a generated contract, `packages/api-client` from it
- Webhooks with the retry ladder 1m → 5m → 15m → 1h → 6h → 24h and an immutable delivery log
- Bulk CSV/XLSX import as an async job with preview and a downloadable result file
- Notifications async (SMS / email / push / in-app), never inline in a request
- Risk scoring as decision support, with visible signals — never an automated accusation

**Gate:** duplicate request rejected by idempotency; webhook endpoint down → retries exhausted
→ failure recorded and merchant-visible; 10k-row import completes without a timeout.

---

## Phase 5 — Advanced logistics

Routing, serviceability depth, rider optimization, offline rider mode.

- Network routing pickup zone → origin → regional → destination → delivery point
- Offline-capable rider app with a durable local command queue, every command idempotent
- Rider assignment scoring by distance, capacity, workload, SLA
- Timezone- and holiday-aware SLA calculation (Asia/Dhaka)

**Gate:** rider completes a full day of jobs in airplane mode, reconnects, and the server
rejects every duplicate while applying each command exactly once.

---

## Phase 6 — Operations

Control tower, analytics projections, observability maturity, simulation, load testing.

- Control tower: live map, assignment, rerouting, holds, exceptions
- Analytics projections from the event stream, never slowing a transaction
- Simulation engine (`simulate shipment ZP-8F32A1 --scenario customer-refused`) and seed data
- Load tests against the targets in `docs/operations/performance.md`

**Gate:** a new engineer can clone, seed, and reproduce the flagship story and the failure story
from the docs alone, in under 30 minutes.

---

## Deliberately deferred

Do not build these until a phase gate above forces the issue. Each has a named trigger.

| Deferred                            | Trigger                                                           |
| ----------------------------------- | ----------------------------------------------------------------- |
| k3s / Kubernetes                    | single-VPS deployment stops being enough                          |
| OpenSearch / Elasticsearch          | PostgreSQL search measurably insufficient                         |
| Object storage (S3)                 | proof-of-delivery media exceeds local disk                        |
| Merchant SDKs (TS, Go, PHP, Python) | a third-party integration actually asks for one                   |
| Warehouse + packaging domains       | a real merchant needs fulfilment, not just delivery               |
| Optimal routing / VRP               | rider-utilisation KPI becomes the business constraint             |
| Read replicas, CQRS split           | reporting load degrades transactional latency                     |
| Microservices                       | a module needs independent scaling, deployment, or team ownership |

---

## Portfolio checklist

A reviewer should be able to answer, unprompted:

- [ ] What problem does ZipZap solve?
- [ ] How does a shipment actually move, and where does that logic live?
- [ ] How does COD money stay correct, and what happens on a duplicate collect?
- [ ] How does a duplicate request fail safely?
- [ ] How does an outage degrade instead of corrupting?
- [ ] Why these technologies, and what was rejected?
- [ ] How would this become services without a rewrite?
