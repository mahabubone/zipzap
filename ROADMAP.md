# ROADMAP.md

Build order for ZipZap. Every phase has an **exit gate** — a check you can run, not a feeling. A
phase is not done until its gate passes.

**Last updated:** 2026-10-05 · OpenAPI + api-client + contract tests live-proven

---

## How to read this

| Marker                  | Meaning                                                        |
| ----------------------- | -------------------------------------------------------------- |
| ✅                      | Done and verified. The evidence is named.                      |
| 🔲                      | Not started.                                                   |
| ⚠️ **OPEN**             | Started, or claimed, but not actually finished.                |
| ⛔ **Deliberately not** | A decision to skip it, with the trigger that would reverse it. |

**A checkbox is only ticked when the thing is verifiable.** "Implemented" means there is a test,
a migration, or a command that proves it. An unticked box is a to-do, not an oversight.

The product view of these phases is in [docs/product/roadmap.md](docs/product/roadmap.md). This
file is the build view and is the one to follow when implementing.

---

## Where we are

| Phase                      | Scope                                                         | State                                                     |
| -------------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| **0 — Foundation**         | repo · docs · ADRs · infra · primitives · fakes               | ✅ done, ⚠️ 1 open item                                   |
| **1 — Foundation domain**  | identity · merchant · shipment · tracking · pricing           | 🔄 in progress: pricing shipped, spine proven live        |
| **2 — Logistics**          | pickup · rider · hub · network · delivery · returns           | 🔄 in progress: pickup, rider, delivery live-proven       |
| **3 — Finance**            | cod · ledger · settlement                                     | 🔄 in progress: collect→ledger→settle→approve live-proven |
| **4 — Platform**           | public API · webhooks · bulk · notifications · risk · support | 🔲                                                        |
| **5 — Advanced logistics** | routing · serviceability · rider optimisation · offline sync  | 🔲                                                        |
| **6 — Operations**         | control tower · analytics · simulation · load testing         | 🔲                                                        |

**The spine: one shipment, end to end.**

Everything in this roadmap exists to make this story demonstrable:

```
merchant creates order → pricing → pickup requested → rider assigned → rider picks up
→ origin hub scan → dispatch → destination hub → rider assigned → out for delivery
→ customer receives parcel → COD collected → shipment delivered → merchant webhook
→ COD reconciliation → settlement
```

The same event must be visible in five places simultaneously — merchant dashboard, operations
console, rider app, customer tracking page, financial dashboard. **That simultaneity is the
portfolio demonstration.** It is only possible if the module boundaries held, which means it is
the acceptance test for the architecture, not just for the features.

---

## Rules that gate every phase

Five rules, in priority order. Everything else is negotiable. Full statements in
[AGENTS.md](AGENTS.md).

1. PostgreSQL is the transactional source of truth.
2. Modules own their data and their business rules.
3. Cross-module communication is an explicit contract — never an accidental table join.
4. Events describe facts; jobs do work.
5. Microservices are an extraction strategy, not a starting architecture.

**Enforcement, not documentation.** A rule that is only written down is a wish. Each phase's gate
therefore includes a check that the rule is mechanically enforced — a test that fails when it is
broken, or a grep in CI.

---

## Phase 0 — Foundation

### ✅ Delivered

**Repository**

- [x] pnpm 11 workspaces + turbo 2.11 monorepo
- [x] TypeScript 6.0.3 pinned — TS 7 ships `tsc` only and `@nestjs/cli` needs the compiler API
- [x] Prettier as formatter; `noUnusedLocals` / `noUnusedParameters` in place of ESLint
- [x] `pnpm verify` = format:check → typecheck → test, and it is green
- [x] `.env.example` committed, `.env` gitignored, no secrets in history

**Documentation** — 68 files

- [x] `docs/product/` — vision, personas, surfaces, roadmap, glossary (5)
- [x] `docs/architecture/` — overview, module-boundaries, database, eventing, state-machines,
      money-and-ledger, extraction, **provider-adapters** (8)
- [x] `docs/domains/` — index + one file per module, mirroring the module graph 1:1 (19)
- [x] `docs/api/` — auth, versioning, errors, pagination, idempotency, bulk, webhooks,
      rate-limits, index (9)
- [x] `docs/operations/` — deployment, observability, reliability, retention-privacy,
      performance, demo-scenarios (6)
- [x] `docs/development/` — environment, workflow (2)
- [x] `docs/testing/` — strategy, fixtures (2)
- [x] **15 ADRs** recording what was rejected and why
- [x] `prompt.txt` gitignored; the distilled docs are the source of truth

**Local infrastructure** — `infra/compose`

- [x] PostgreSQL 18 + PostGIS 3.6, with a healthcheck that runs a real spatial query
- [x] Redis 8, NATS 2.11 with JetStream
- [x] Mailpit (SMTP) and MinIO (S3) — **real** local implementations, not fakes
- [x] Prometheus + Grafana behind an `observability` profile
- [x] Host ports parameterised so it coexists with another stack on the same machine

**Backend skeleton** — `apps/backend`, 27 TypeScript files

- [x] Three entrypoints from one module graph: `main.ts` · `worker.ts` · `publisher.ts`
- [x] **19 module schemas** created by migration, one per module
- [x] Per-module TypeORM connection scoped to its own schema — the mechanical enforcement of
      rule 2, so a cross-module query fails at runtime rather than in production
- [x] `synchronize: false` in every environment, permanently
- [x] Global transactional **outbox** with a partial index on unpublished rows
- [x] **Outbox publisher** as the only process that touches NATS, draining with
      `FOR UPDATE SKIP LOCKED`
- [x] **`Money`** as integer minor units, with exact remainder allocation and no float anywhere
- [x] **Domain errors** mapped once, in a single exception filter, to the §87 envelope; the
      registry is asserted exhaustive by test
- [x] **Idempotency** keyed per operation class and per merchant, request body hashed
- [x] snake_case naming strategy, and an `int8`-only `pg` type parser
- [x] `/healthz`, `/readyz`, Swagger at `/docs`

**Provider fakes** — `infra/fakes`, 7 TypeScript files

- [x] PayStation, contract-verified against the published documentation
- [x] MiMSMS Bulk SMS API v2.1, contract-verified against the published Postman collection
- [x] Scriptable faults, recorded calls with raw bodies, retrying IPN delivery
- [x] Nothing invented — see the honesty rule below

### ✅ Verification evidence

Not "should work" — run and observed:

| Check                                         | Result                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`                                 | green — 78 tests (37 backend + 41 fakes)                                                                              |
| Migrations against real Postgres 18 + PostGIS | 4 applied, 19 schemas created                                                                                         |
| **Append-only enforced**                      | event columns and `DELETE` rejected; publisher bookkeeping still writable                                             |
| Three entrypoints boot                        | `/healthz` 200 · `/readyz` 200 · `/docs` 200                                                                          |
| **Outbox → NATS proven live**                 | rows drained to `zipzap.shipment.delivered`, `zipzap.cod.collected`, `zipzap.settlement.completed`                    |
| IPN retry ladder                              | failing receiver saw 3 identical IPNs, `delivered=false`; recovering receiver saw `[500, 500, 200]`, `delivered=true` |
| Scripted outage                               | 503, 503, 202                                                                                                         |
| Both provider contracts                       | `+8801…` rejected · 2-recipient `T` rejected · Bangla segmented as UCS-2                                              |

### ⚠️ Open item

- [ ] **CI workflow.** `.github/workflows/` does not exist. `pnpm verify` runs locally and is
      green, but nothing enforces it on a pull request. This is the one gap between "Phase 0 is
      designed" and "Phase 0 is complete". Until it exists, the phase gate below passes on a clean
      clone but the _invariant_ is not protected against regression.

### ⛔ Deliberately not done in Phase 0

| Skipped                        | Why it can wait                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Frontend workspace packages    | ~60 files of boilerplate that the first real screen would rewrite. Building one vertical first gives a proven shape to clone. |
| Git hooks / pre-commit         | CI is the right gate; local hooks are a fast-fail convenience on top of it.                                                   |
| ESLint                         | `noUnusedLocals` + Prettier cover what applies. Add it when a rule cannot be expressed in either.                             |
| Elasticsearch / search cluster | PostgreSQL search is sufficient until measured otherwise.                                                                     |
| Read replicas                  | CQRS is logical here. Splitting reads from writes is a scale decision.                                                        |

### Exit gate

```bash
git clone <repo> && cd zipzap
corepack enable && pnpm install
cp .env.example .env
pnpm infra:up && pnpm db:migrate && pnpm dev
curl -s localhost:3000/healthz   # 200
curl -s localhost:3000/readyz    # 200
pnpm verify                      # green
```

**Status: passes.** The CI workflow remains open.

---

## Phase 1 — Identity, merchant, shipment, tracking

The minimum needed to accept an order and show where it is. Everything downstream is a consumer
of these facts, which is why this phase is first and why finishing it properly is worth more than
starting three more phases.

### 🔲 `identity`

- [ ] Schema `identity`: `users`, `identities`, `sessions`, `credentials`, `devices`, `roles`,
      `permissions`, `role_permissions`
- [ ] Two principal kinds, separately: **human** (session cookie) and **machine** (API key +
      secret). A merchant API key must never open a browser session.
- [ ] Password hashing with argon2id. Never MD5, SHA-1, or unsalted SHA-256.
- [ ] API secrets hashed and compared, never stored raw. `last_used_at`, rotation, revocation.
- [ ] Session rotation on privilege change — a role change invalidates live sessions.
- [ ] Guard enforcing **permissions** (`shipment:create`, `settlement:approve`), never role names
- [ ] **Tenant scoping derived from the principal**, never accepted from the request body
- [ ] Role bundles: `PLATFORM_ADMIN`, `OPERATIONS_MANAGER`, `HUB_OPERATOR`, `SUPPORT_AGENT`,
      `MERCHANT_OWNER`, `MERCHANT_OPERATOR`, `RIDER`
- [ ] Audit events: login, failed login, logout, credential rotation, credential revocation
- [ ] Migration + `docs/domains/identity.md` updated

### 🔲 `merchant`

- [ ] Schema `merchant`: `merchants`, `users`, `branches`, `addresses`, `contracts`,
      `pricing_profiles`, `settlement_accounts`, `api_credentials`, `webhooks`
- [ ] Lifecycle machine: `APPLIED → UNDER_REVIEW → VERIFIED → ACTIVE ⇄ SUSPENDED`
- [ ] Suspension blocks new shipments and preserves in-flight ones
- [ ] Scopes: `shipments:read/write`, `tracking:read`, `returns:write`, `settlements:read`,
      `webhooks:manage`
- [ ] Per-merchant rate limits from the contract
- [ ] **No `balance` column here.** Balance is derived from the ledger in Phase 3.
- [ ] Migration + doc

### 🔲 `shipment` — the central aggregate

- [ ] Schema `shipment`: `shipments`, `parcels`, `scans`
- [ ] Value objects: tracking code, addresses, parcel dimensions, weight, money
- [ ] **Non-sequential, non-guessable tracking codes** (`ZP-8F32A1`) with a unique index. A
      guessable code is a customer-address enumeration vector on a public endpoint.
- [ ] **Validated state machine** from the transition table in
      [architecture/state-machines.md](docs/architecture/state-machines.md) — every `from` × `to`
      pair tested, legal passes and everything else throws
- [ ] Transitions serialise on the shipment row (`SELECT … FOR UPDATE`) so two simultaneous
      scans cannot both advance the machine
- [ ] **Exhaustive transition test** — the highest-value test in the repository
- [ ] Every transition appends a scan _and_ a tracking event; one fact, one record
- [ ] Idempotency-keyed creation
- [x] Frozen `pricing_version` at creation — via PricingService, proven live 2026-10-03
- [ ] Migration + doc

### 🔲 `tracking`

- [ ] Schema `tracking`: `events`, append-only, `REVOKE UPDATE, DELETE` **enforced by trigger**
      — not by `REVOKE` from the owner, which is a no-op in PostgreSQL and was verified to be
- [ ] `occurred_at` distinct from `recorded_at`; both needed for audit
- [ ] Corrections are **new events** referencing the original, never rewrites
- [ ] Public tracking projection built as a **separate read model** — the dangerous fields are
      not present, so there is no query to get wrong
- [ ] `GET /track/:trackingCode` with no account
- [ ] Partitioning and retention from day one — this is the largest table in the system
- [ ] Migration + doc

### ✅ `pricing` — shipped 2026-10-03

- [x] Schema `pricing`: `versions` (frozen rule rows). Quotes are computed, not stored — storing
      the version number on the shipment is the dispute evidence.
- [x] Itemised composition: base + weight + COD + remote area + handling + packaging + tax −
      discount. A quote returns **every line**, never just a total.
- [x] Resolution order: default → merchant profile → volume discount → custom contract, with the
      version number itself never overridable.
- [x] **Deterministic**: same inputs + same version = same quote, always. No clock, no randomness,
      no network calls inside the engine. Proven live: replay returned 12862 twice.
- [x] Versioned quotes; a shipment stores the version it used (`pricingVersion`, frozen).
- [x] **No hardcoded price in any handler** — `pricingVersion: 1` is gone.
- [x] Migration 0008 (seeds v1 as active) + `POST /v1/pricing/quote`.
- [x] `PricingVersionNotFoundError` maps unknown/active-missing to a 409 envelope, not a 500.

### 🔲 Cross-module

- [x] `GET /v1/shipments` with cursor pagination, total ordering (`created_at DESC, id DESC`)
      (live 2026-10-05: 6000 rows over 30 cursor hops, zero repeats; bad cursor → 400,
      forged non-UUID → 400, foreign UUID → empty page (own-list scope); cross-merchant
      list returns only own rows)
- [ ] Error envelope on every failure path, mapped once
- [ ] `Idempotency-Key` honoured and its response stored
- [ ] OpenAPI generated; `packages/api-client` generated from it
- [ ] Seed data: geography, one merchant, one credential

### Exit gate

- [ ] Create a shipment via `POST /v1/shipments` with an `Idempotency-Key`
- [ ] Replay the same key with the same body → **original response, one row**
- [ ] Replay the same key with a _different_ body → `400 INVALID_IDEMPOTENCY_KEY`
- [ ] Kill the publisher, mutate, restart it → the event lands **exactly once**
- [ ] Concurrent duplicate `Idempotency-Key` → exactly one shipment created
- [ ] Attempt an invalid transition → `409 INVALID_TRANSITION`, and the state machine test proves
      every illegal pair is rejected
- [ ] Try to read another merchant's shipment → `404`, not `403` (no enumeration oracle)
- [ ] `UPDATE tracking.events` and `DELETE FROM tracking.events` both rejected **by the database**
- [ ] `pnpm verify` green; a cross-module table access **fails the build**

### Risks

| Risk                                      | Mitigation                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Identity scope creep into other modules   | Guards only; no module may read `identity` tables. A permission without tenant scope is a breach.         |
| Shipment aggregate absorbing everything   | State machine, scans and tracking are separate modules with their own schemas.                            |
| Tracking table outgrowing the design      | Partition by time from the first migration. Retrofitting partitioning on a live table is a night of pain. |
| Idempotency added late and inconsistently | It is in `common/` already, with tests. It is not per-endpoint optional work.                             |

---

## Phase 2 — Logistics

Movement. This is where the product stops being an order form and becomes a courier.

### 🔲 `network` — zones, routes, manifests, geo

- [ ] Bangladesh hierarchy: division → district → upazila → union → ward → delivery point
- [ ] `geography(Point|MultiPolygon, 4326)`, **not** `geometry` — metres, not coordinate units
- [ ] `GIST` index on every geometry column
- [ ] **Coverage as data**: `serviceable`, `estimated_days`, `pickup_available`,
      `delivery_available`, `COD_available`. Never `if (city === 'Dhaka')`.
- [ ] Serviceability check **before** shipment creation, with a reason
- [ ] Route → RouteLeg → Trip. Fixed topology first.
- [ ] Manifest lifecycle `DRAFT → SEALED → DISPATCHED → RECEIVED → RECONCILED`
- [ ] **A missing shipment at reconciliation becomes an exception.** Silence is never the answer.
- [ ] Seed: 8 divisions, 64 districts, sample upazilas and hubs

### 🔲 `pickup`

- [ ] Schema `pickup`: `requests`, `batches`, `assignments`, `attempts`
- [ ] First-class workflow, not an implicit side effect of shipment creation
- [ ] **Batching**: one assignment covers many parcels. Bounded by count, weight, or time window.
- [ ] Idempotency-keyed requests
- [ ] `ExpirePickupRequest` scheduled job
- [ ] Scan required per parcel to complete

### 🔲 `rider`

- [ ] Schema `rider`: `riders`, `profiles`, `devices`, `availability`, `assignments`,
      `performance`
- [ ] State `OFFLINE ⇄ AVAILABLE → ON_PICKUP / ON_DELIVERY`, `ON_BREAK`, `SUSPENDED`
- [ ] Assignment scoring: distance, zone, location, capacity, workload, availability, vehicle,
      priority, SLA
- [ ] **Deterministic and explainable, not optimal.** Ties break on `rider_id`, never iteration
      order. When a customer asks why the parcel went the long way, operations need an answer they
      can read.
- [ ] Devices revocable — cuts off offline sync from a lost phone
- [ ] Performance metrics as projections, never written on a scan's hot path

### 🔲 `hub`

- [ ] Schema `hub`: `hubs`, `zones`, `staff`, `capacity`, `schedules`, `routes`
- [ ] Types `REGIONAL_HUB` · `DISTRICT_HUB` · `LOCAL_HUB` · `DELIVERY_POINT`
- [ ] Inbound scan-in → sort → destination; outbound dispatch batch → manifest → scan-out
- [ ] Capacity modelled, so "hub backlog" is actionable rather than decorative
- [ ] Discrepancies raise: received-not-on-manifest, manifested-not-received, received-twice

### 🔲 `delivery`

- [ ] Schema `delivery`: `jobs`, `attempts`, `proof`, `failure_reasons`
- [ ] `CREATED → ASSIGNED → ACCEPTED → OUT_FOR_DELIVERY → ATTEMPTED → DELIVERED | FAILED`
- [ ] **Structured failure reasons**, never free text — a free-text reason gives operations a
      string to read and nothing to act on
- [ ] Retryable vs terminal reasons distinguished. Retrying a wrong address burns rider time and
      delays every parcel behind it.
- [ ] Proof: OTP + photo + timestamp + GPS + rider identity. **Required** for `DELIVERED`.
- [ ] Delivery confirmation idempotency-keyed
- [ ] Proof media treated as sensitive customer data

### 🔄 `returns` — full machine + live reversal 2026-10-05

- [x] Schema `returns`: `requests` (migration `0015-ReturnsSchema`, transition-guarded by
      trigger). `approvals`/`transitions`/`reasons` live as columns + closed vocab, not tables —
      one row per return, reasons as enum.
- [x] Full chain `RETURN_REQUESTED` through `RETURNED` (merged vocabulary: decision half
      from returns.md, custody legs from state-machines.md; `TO_MERCHANT` dropped as a
      status-masquerading-as-leg)
- [x] **References the original shipment.** Unique index on `shipment_id`; second return rejected.
- [x] Forward lifecycle is never rewound — terminal states accept nothing; 64-pair exhaustive test
- [x] Financial consequences as compensating entries via events (`ReturnCompleted` →
      `ADJUSTMENT`, both rows visible, balance nets to zero — integration-tested)

### Exit gate

- [ ] The **flagship story** runs to `DELIVERED` in a seeded network
- [ ] The **failure story** runs too: refused → retry → refused → return → merchant receives it
- [ ] An unserviceable destination is rejected at creation with a reason
- [ ] Two riders scanning simultaneously produce exactly one transition and one tracking event
- [ ] A manifest missing a shipment raises an exception at reconciliation
- [ ] Assignment is deterministic — the same inputs assign the same rider 100 times
- [ ] Return creates a reversing ledger request, not a second parcel
- [ ] `pnpm verify` green

### Risks

| Risk                                         | Mitigation                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Rider assignment becoming a research project | Explicitly deterministic and explainable. Optimisation is Phase 5 with a named trigger.                      |
| Hub console unusable on a loading dock       | Designed for gloves, glare, dropped connections, bursts. A bypassed scan is a parcel with no custody record. |
| Geo data going stale                         | Upazila boundaries change. Stale boundaries produce confidently wrong serviceability.                        |
| Scope: six modules at once                   | Ship the spine first — pickup → hub → delivery — then the rest.                                              |

---

## Phase 3 — Finance

Money. The phase where correctness stops being optional, because a bug here is not a bug — it is
a disputed payment.

### 🔄 `cod` — collect/reconcile live 2026-10-04; payable tail open

- [x] Schema `cod`: `records` (migration `0009-CodSchema`). `collections`,
      `reconciliation_runs`, `exceptions` tables deferred — one record row per shipment carries
      expected/collected/status today.
- [x] Lifecycle `COD_EXPECTED → COD_COLLECTED → COD_RECONCILED` live; `PARTIAL_COLLECTION` and
      `RECONCILIATION_EXCEPTION` reachable and unit-tested (108 rules tests). The later states
      (`COD_PAYABLE` onward) exist in `rules/cod.ts`, but no service advances past `COD_RECONCILED`.
- [x] Failures: `COLLECTION_FAILED` · `PARTIAL_COLLECTION` · `RECONCILIATION_EXCEPTION` ·
      `SETTLEMENT_HOLD` in the machine (`COD_TRANSITIONS`), all reachable via `collect`/`reconcile`.
- [x] `bigint` columns, integer arithmetic, currency on every row
- [x] **Collection is idempotency-keyed** — `cod.collect` scope in `CollectCodService`, race
      test in `money-path.integration.test.ts` (concurrent double-collect converges on one entry)
- [x] **Partial collection is a first-class outcome.** 125000 against 125050 expected is
      `PARTIAL_COLLECTION`: recorded, reconciled, settled at the collected amount, shortfall
      visible — integration-tested, never hand-reconciled.
- [x] **Reconciliation mismatch blocks; it never auto-corrects.** `ReconcileCodService` only
      resolves `PARTIAL_COLLECTION`/`RECONCILIATION_EXCEPTION` → `COD_RECONCILED` with a recorded
      reviewer note; amounts are never rewritten.
- [x] `COD_EXPECTED` set at creation from the frozen quote — `EnsureCodRecordService` in the
      shipment transaction, proven live 2026-10-04 (125050 seeded, collected, settled)

### 🔄 `finance` — ledger/settlement/approve live 2026-10-04; provider open

- [x] Schema `finance`: `ledger_entries`, `settlements` (migration `0010-FinanceSchema`).
      `accounts`, `settlement_items`, `settlement_batches`, `settlement_adjustments`,
      `provider_transactions` deferred — settlement items live as `items_json` on the row.
- [x] **No `merchant.balance` column.** Balance is `SUM(direction * amount_minor)` via
      `FinanceRepository.balanceMinor`, exposed at `GET /v1/merchants/:id/balance`.
- [x] Ledger append-only, enforced by trigger — `UPDATE`/`DELETE` rejected even from the owner
      (trigger, not REVOKE; REVOKE from an owner is a no-op). Integration-tested.
- [x] Corrections are compensating entries; the wrong row stays visible (`PostLedgerEntryService`
      has no update path by construction)
- [x] `direction` separate from the sign of the amount (`smallint` CHECK `IN (1, -1)`)
- [x] `amount_minor > 0` check constraint
- [x] `reference_type` + `reference_id` on every entry — enforced by `validateLedgerEntry`
- [x] `occurred_at` distinct from `recorded_at` on every entry
- [x] Settlement is a **frozen view** of entries (`CREATED` through `SETTLED`), immutable
      after approval (trigger rejects status regression; late money freezes into the next
      settlement). Full tail live 2026-10-04: approve → initiate → confirm → `SETTLED`,
      payout entry posted, balance reconciles.
- [x] Approval idempotency-keyed, permission-checked (`settlements:approve`), audited
      (`approvedBy`/`approvedAt` on the row) — replay returns the recorded decision byte-for-byte
- [x] `PaymentProvider` port with mock default + PayStation adapter — mock in
      `finance/provider/`, adapter translates wire format (`status_code`, `trx_status`,
      decimal strings) behind the port; binding switches on `PAYMENT_PROVIDER` env.
      Live 2026-10-04 against the fake: initiate → control-API complete → confirm →
      `SETTLED`, `SETTLEMENT_PAYOUT` −125000 posted. Contract tests: 7 green.
- [x] Rebalance test: ledger sums to the settlement total, to the unit
      (`money-path.integration.test.ts`: 100000 − 1800 fee = 98200 balance)

### 🔄 Return reversal — live-proven 2026-10-05

- [x] A returned parcel **reverses** its COD collection with a compensating entry
      (live: collect +125000 → return → `ADJUSTMENT −125000`, both visible)
- [x] Both rows remain visible; the merchant reconciles collection against reversal
      (live: `COD_COLLECTED +125000`, `ADJUSTMENT −125000`; tracking shows the full chain)

### Exit gate

- [x] The ledger balances to the settlement total — asserted to the poisha (integration test +
      live 2026-10-04: 125050 frozen, approved, balance 125050)
- [x] **Corrupt one COD collection deliberately** → reconciliation raises an exception,
      settlement is blocked, review resolves with a recorded note, and both original rows are
      preserved (live 2026-10-04: over-collect 130000 vs 125000 expected →
      `RECONCILIATION_EXCEPTION`, zero ledger rows, `COD_RECONCILED` after human review with
      recorded note; drill also fixed `COD_EXPECTED → RECONCILIATION_EXCEPTION` missing edge)
- [x] Duplicate COD collect with the same key → one collection, original response returned
- [x] Partial collection settles at the collected amount with the shortfall reported
- [ ] 10,000-shipment settlement allocation loses **zero** minor units (remainder test) — no
      remainder allocation exists yet; `netPayable` sums exact items only
- [x] `UPDATE finance.ledger_entries` rejected by the database
- [x] `pnpm verify` green

### Risks

| Risk                                     | Mitigation                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A counter reintroduced for performance   | The balance query is documented as the source. A projection is acceptable; a stored counter is not. |
| Rounding quietly losing money            | Remainder allocation is explicit, tested, and sums exactly.                                         |
| Auto-reconciliation hiding a discrepancy | Mismatch blocks settlement. This is the one behaviour that must not be optimised.                   |
| Retention deleting financial evidence    | Ledger retention is long and separate from operational data. Partitioning, never `DELETE`.          |

---

## Phase 4 — Platform

Self-service and integration. The point at which a merchant can run on ZipZap without talking to
a human.

### 🔲 Public API v1

- [x] Full `/v1` surface per [docs/api/_index.md](docs/api/_index.md)
      (live 2026-10-05: shipment detail + cancel, webhook list, pickup/returns/COD/settlement
      lists — five cursor-paginated collections + two bounded reads; COD walk 1600 rows zero
      repeats; doc table now marks ✅/🔲/decision per route)
- [ ] API key auth with scopes and per-merchant rate limits
- [x] Cursor pagination on every unbounded collection, total ordering
      (shipments, pickups, returns, COD records, settlements — all `created_at DESC, id DESC`;
      webhook endpoints bounded, deliberately unpaginated per docs/api/pagination.md)
- [ ] Error envelope on every path, from the single filter
- [x] `RateLimit-*` headers, `Retry-After` on 429
      (live 2026-10-05: merchant list → `RateLimit-Limit: 600`, public track →
      `100`; 105 rapid hits → 96×200 + 9×429 with `RATE_LIMITED` envelope)
- [x] OpenAPI generated; `packages/api-client` generated from it; both committed together
      (live 2026-10-05: export deterministic + DB-free, 33 paths; client binds generated DTO
      types, `ZipZapApiError` carries the §87 envelope + Retry-After; regen wired into CI)
- [x] Contract tests asserting the spec matches observed behaviour
      (8 green: spec↔live path parity both directions, 401 + envelope, RateLimit headers,
      bad cursor 400, unknown tracking 404-not-401, idempotent create replay)

### 🔄 Webhooks — skeleton live 2026-10-04; replay on demand open

- [x] Event subscriptions: `shipment.created` … `settlement.completed` (6 subjects, parity-pinned)
- [x] **HMAC-SHA256 over `{timestamp}.{raw_body}`** — raw body, constant-time compare, 5-min window
- [x] Retry ladder 1m → 5m → 15m → 1h → 6h → 24h, then a visible failed state (one job per
      attempt, ladder delays as job delay — not BullMQ backoff)
- [x] 4xx is **not** retried — 429 honours retry; timeouts always retry
- [x] Immutable delivery log: every attempt, success and failure (trigger-append-only)
- [x] **Pause beats delete** — `PAUSED`/`ACTIVE` endpoints, `FAILING` auto-flag; no delete path
- [x] Fast acknowledgement; work happens after the 2xx — consumer enqueues, processor sends;
      replay-on-demand at `POST /v1/webhooks/deliveries/:id/replay` (terminal-only, fresh id)
- [x] Endpoints CRUD over HTTP (`POST /v1/webhooks`, rotate/pause/resume) — proven live 2026-10-04:
      endpoint registered, secret issued, signed `shipment.delivered` received 200

### ✅ Bulk import — live-proven 2026-10-05 (2-row walk + 10k load)

- [x] `POST /v1/shipments/bulk` → `202` with a job id, never a synchronous insert of thousands
      (`/upload` stores the preview, `/accept` enqueues 100-row chunks)
- [x] Stages, trigger-guarded (`PENDING` through `COMPLETED_WITH_ERRORS`; validate collapses
      into preview — parsing IS validation, stored rows ARE the checkpoint)
- [x] **Human preview checkpoint** — per-row READY/FAILED with reasons before anything inserts
- [x] Idempotent on **merchant invoice reference**, with row-level outcomes
      (`SKIPPED_DUPLICATE` recorded, never a second parcel)
- [ ] CSV + XLSX in, CSV out — CSV done both directions; XLSX explicitly deferred
- [x] Chunked execution — 100 rows per job, one transaction per chunk
- [x] Downloadable result file, row by row (`GET :jobId/result`)

### ✅ `notification` — code + contract tests green, outage drill proven live 2026-10-05

- [x] Schema `notification`: `templates`, `messages`, `deliveries` (migration `0016`;
      `preferences` deferred — no opt-out surface yet)
- [x] Consume the event, enqueue a BullMQ job, send from the worker. **Never send inline.**
- [x] Idempotent on `(eventId, channel, recipient)` — unique index + redelivery converges
- [x] Versioned templates; the version is stored on the delivery row (en+bn v1 seeded in code)
- [ ] Per-send throttling and quiet hours — deferred; the ladder bounds retries, not send rate
- [x] **Dead-letter only on carrier retry policy `0`.** Handset-off (policy 3) retries.
- [x] All parcel notifications sent transactional — never batched promotionally
- [x] MiMSMS adapter: `8801XXXXXXXXX`, **not** `+8801…` (plus stripped at the wire, bad numbers
      throw before HTTP; 6 contract tests green against the fake)

### 🔲 Risk signals — scoped, not started

Decision-support only (never auto-block): score + explained signals from phone/merchant/COD
history. Needs the returns + settlement history just landed. No tables, no code yet.

### 🔲 `support` + developer portal — scoped, not started

Tickets + audited cross-module reads. `COD_RECONCILIATION_EXCEPTION` and failed webhooks are
the natural auto-ticket sources once the module exists. No tables, no code yet.

### Exit gate

- [x] Duplicate request rejected by idempotency, returning the original response
      (contract test, live 2026-10-05: same key + same body → 201 replayed with the same id;
      same key + different body → 400 `INVALID_IDEMPOTENCY_KEY`, never a silent replay)
- [x] Webhook endpoint down → retries on the ladder → terminal failed state visible to the merchant
      (live 2026-10-04/05: dead endpoint climbed 1m → 5m → 15m → 1h → 6h with one immutable
      row per attempt, `fetch failed`, attempt-6 enqueued in the delayed set; per-attempt rows
      are the merchant-visible failed state — `terminal` flips on attempt 6)
- [x] 10,000-row import completes without a timeout and yields a downloadable row-level result
      (live 2026-10-05: upload 0.9s → 100 chunks → `COMPLETED` 10000/10000 in ~96s, zero
      failures; result CSV downloadable, 10000 rows each with a shipment id, zero orphans.
      Found and fixed live: JSON body limit raised to 10MB, upload insert batched at 500 rows
      for the 65535 bind-param cap, job-trigger allows counter-only updates, per-row code reads
      single rows (O(n²) removed), retried chunks replay terminal rows instead of failing them)
- [x] Webhook signature verifies over the **raw** body, asserted in a test
      (`webhook.spec.ts`: byte-exact input matters — whitespace/reorder breaks the signature;
      plus the live proof where the signature cryptographically verified)
- [x] A merchant with only `shipments:write` cannot read settlements or delete a webhook
      (live 2026-10-05: shipments-scoped credential → 403 Missing scope; guard is per route)
- [x] Notification provider outage → retries → dead-letter visible, and **the transaction that
      triggered it still succeeded** (live 2026-10-05: scripted 503s on every SMS send —
      shipment created 201 mid-outage; attempts 1–2 failed non-terminal, ladder climbed 5m →
      15m → 1h → 6h → 24h via promoted delayed jobs, attempt 6 terminal, message row QUEUED →
      FAILED. Fixed live: the throw path hardcoded `terminal: false`, so an outage could never
      reach a visible terminal state; past the last rung the message now marks FAILED
      (DEAD_LETTERED on carrier policy 0))
- [ ] `pnpm verify` green

---

## Phase 5 — Advanced logistics

Depth in the network model. Every item here has a trigger; none is needed for the flagship demo.

### 🔲 Routing and serviceability

- [ ] Network routing: pickup zone → origin → regional → destination → delivery point
- [ ] Timezone- and holiday-aware SLA. **Asia/Dhaka**, with cutoff times and a holiday calendar.
- [ ] Serviceability depth: capacity-aware and multi-stop rider routing

### 🔲 Rider optimisation

- [ ] Workload and capacity-aware assignment
- [ ] Utilisation as a measured KPI, then optimised — **in that order**

### 🔲 Offline rider mode

- [ ] Local-first app: every mutating action goes through the local queue, not just the last few
- [ ] Durable local storage with its own integrity story — a cleared cache loses queued scans
- [ ] Ordered replay by `created_at`; a command that is no longer valid is **rejected explicitly**
      and reported back to the device. Silently dropping it leaves the rider believing a scan
      succeeded that did not.
- [ ] Storage cap and alert — a device offline indefinitely grows without bound

### Exit gate

- [ ] A rider completes a full day of jobs in airplane mode, reconnects, and the server rejects
      every duplicate while applying each command exactly once
- [ ] A cancelled-while-offline shipment's scan is explicitly rejected, not silently dropped
- [ ] Assignment improves a measured utilisation KPI, with the before/after recorded
- [ ] `pnpm verify` green

---

## Phase 6 — Operations

Running it at volume, and proving it.

### 🔲 Control tower

- [ ] Live counts: today's shipments, active pickups, in transit, at hub, out for delivery,
      delivered, failed, returned, COD outstanding, riders online, hub backlog
- [ ] Live map of hubs, riders, destinations
- [ ] Actions: inspect, assign pickup, assign/reassign rider, transfer, hold, release, initiate
      return, inspect attempt, inspect COD, raise a ticket
- [ ] `apps/desktop` Electron shell over the console

### 🔲 Analytics

- [ ] Projections fed by events, fed by nothing else
- [ ] **Rebuildable from scratch.** `analytics:rebuild` must work. If it does not, the projection
      has become authoritative by accident, and that is the bug to fix first.
- [ ] KPIs with their formulas and their source events documented
- [ ] Every dashboard showing a money figure says so, or reads from finance
- [ ] PostgreSQL search first; a search cluster only when measured insufficient

### 🔲 Simulation and seed

- [ ] `simulate shipment ZP-8F32A1 --scenario <name>`
- [ ] Scenarios: `delivered` · `failed-then-delivered` · `customer-refused` · `returned` · `lost`
      · `damaged`
- [ ] The simulator goes through the **real state machine and the real outbox.** A simulator that
      writes statuses directly can demo a transition the product cannot perform.
- [ ] Seed profiles: `demo` (small) and `load` (100 merchants, 1,000 customers, 100 riders,
      20 hubs, 10,000 shipments), deterministic from a fixed seed

### 🔲 Observability maturity

- [ ] `/metrics` on all three entrypoints
- [ ] Dashboards: API, database, eventing, workers, business, operations
- [ ] Alerts on symptoms, not causes: `outbox_pending`, `nats_consumer_lag` growing, 5xx rate,
      pool saturation, job failures, **and COD collection dropping to ~0 in business hours** —
      a business outage no 5xx rate will show
- [ ] Metric cardinality controlled: never label by shipment id, rider id, request id, or a URL
      containing an id
- [ ] Every alert links to a dashboard

### 🔲 Load testing

- [ ] Shipment creation · tracking · merchant dashboard · bulk import · webhook processing
- [ ] Measure RPS, p50/p95/p99, DB utilisation, queue lag, event processing rate
- [ ] **Replace the targets in [docs/operations/performance.md](docs/operations/performance.md)
      with measurements.** Those numbers are currently hypotheses, and the first honest thing to do
      with them is run this test.

### Exit gate

- [ ] A new engineer clones, seeds, and reproduces both the flagship and failure stories **from
      the docs alone**, in under 30 minutes
- [ ] `analytics:rebuild` reproduces every projection exactly
- [ ] Every reliability scenario in [docs/operations/reliability.md](docs/operations/reliability.md)
      induced and asserted: Postgres down, Redis down, NATS down, publisher killed, worker killed,
      duplicate event, duplicate request, rider reconnect, duplicate settlement
- [ ] Performance targets replaced by measured numbers
- [ ] `pnpm verify` green

---

## Cross-cutting workstreams

These run across phases rather than inside one.

### Provider integrations

- [x] Fakes for PayStation and MiMSMS, both contract-verified
- [x] `PaymentProvider` adapter for PayStation — in-band errors, money conversion, status mapping
      (`finance/provider/paystation.adapter.ts`, 7 contract tests green against the fake, live
      `SETTLED` proven 2026-10-04; v2 trxId lookup, unknown-status throws, amount-mismatch throws)
- [x] `NotificationChannel` adapter for MiMSMS — `8801…` formatting, kind-vs-`T` mapping at
      the wire, DLR retry policy (`notification/provider/mimsms.adapter.ts`, 6 contract tests
      green against the fake; domain speaks `transactional`, never the `"T"` token)
- [ ] Fault injection wired into CI so failure paths are exercised on every run
- [ ] Contract tests against real sandboxes before go-live — **a passing fake proves the wiring,
      not the integration**
- [ ] Mailpit wired for email; MinIO for proof-of-delivery media

### CI/CD

- [ ] ⚠️ **Pull request workflow** — the one open Phase 0 item
- [ ] Format → lint → typecheck → unit → integration → build → container → security scan
- [ ] Integration tests with Testcontainers: Postgres, Redis, NATS
- [ ] Module-boundary grep enforced in CI, not just documented
- [ ] Migration applied and rolled back in CI against a real database
- [ ] Container build and a deploy path to a single VPS

### Security

- [ ] Secrets from a secret store, never in an image or a committed `.env`
- [ ] Rate limiting fails **closed on writes**, open on reads
- [ ] Argon2id; constant-time comparison on every secret and signature
- [ ] Customer data access audited on **read**, not merely restricted
- [ ] `REQUEST_ID` correlation from the edge through every log and span
- [ ] Dependency audit in CI; Renovate for updates

---

## Deliberately deferred

Do not build these until a phase gate above forces the issue. Each has a named trigger — the
trigger is the point, not the deferral.

| Deferred                           | Trigger                                                          | Why it is safe to wait                                                                               |
| ---------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Kubernetes / k3s                   | Sustained resource pressure, or the database must leave the host | One VPS is cheaper and simpler; a cluster is operational surface with no problem to spend it on      |
| Elasticsearch / OpenSearch         | A measured search query is insufficient                          | `pg_trgm` + `tsvector` + GIN handles tracking-code, phone and name at this scale                     |
| Read replicas, CQRS split          | Reporting load degrades transactional latency                    | CQRS is logical today; splitting introduces replication lag where we promised strong consistency     |
| Warehouse + packaging domains      | A merchant needs fulfilment, not just delivery                   | A different business with a different lifecycle, competing with the one that proves the architecture |
| Optimal routing / VRP              | Rider utilisation becomes the binding business constraint        | Deterministic and explainable beats marginally better and unexplainable                              |
| Second payment gateway             | A merchant asks for one                                          | The integration layer is exercised by one; a second adds maintenance and no insight                  |
| Merchant SDKs (TS, Python, PHP)    | A third-party integration actually asks for one                  | Generated `packages/api-client` covers our own surfaces today                                        |
| Additional markets                 | Bangladesh is working end to end                                 | A second market is the real test of whether the model is general or merely local                     |
| Read-your-own-writes for consumers | A consumer genuinely needs it                                    | Costs an extra hop; NATS is already seconds-level                                                    |

---

## Portfolio checklist

A reviewer should be able to answer, unprompted:

- [ ] What problem does ZipZap solve?
- [ ] How does a shipment actually move, and where does that logic live?
- [ ] How does COD money stay correct?
- [ ] What happens on a duplicate request?
- [ ] How does an outage degrade instead of corrupting?
- [ ] Why these technologies, and what was rejected?
- [ ] How would this become services without a rewrite?

That is the definition of done for the portfolio, and it is a test of the documentation as much
as of the code.

---

## Keeping this document current

- Update **Last updated** and the phase table whenever a gate passes or a phase starts.
- Tick a checkbox only when the thing is **verifiable** — a test, a migration, or a command.
- If a phase's scope changes, record it in the relevant ADR rather than rewriting history here.
- New deferred item? Add it to the deferred table **with its trigger**. A deferral without a
  trigger is just a postponement.
- A gate that can no longer be run as written is a stale gate. Fix the gate before trusting it.
