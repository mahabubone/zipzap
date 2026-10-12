# state.md

Working context for whoever picks this up next — including a future agent with no memory of
the conversation that produced it.

**This file is not the source of truth.** `docs/` is. Where the two disagree, `docs/` wins and
this file is the bug. Sourced from [`ROADMAP.md`](ROADMAP.md), [`docs/product/vision.md`](docs/product/vision.md),
[`docs/product/surfaces.md`](docs/product/surfaces.md), [`AGENTS.md`](AGENTS.md) and `git log`.

**Last updated:** 2026-10-11 · **Where:** 6 surfaces built of 10 planned (5 web/mobile + the docs site) · **Verify:** `pnpm verify`

---

## 1. Full picture — the thing being built

**ZipZap** is a logistics operating system for e-commerce merchants, riders, hubs and delivery
operations. Bangladesh first. It models a real courier business end to end.

```
merchant creates order → pricing → pickup requested → rider assigned → rider picks up
→ origin hub scan → dispatch → destination hub → rider assigned → out for delivery
→ customer receives parcel → COD collected → shipment delivered → merchant webhook
→ COD reconciliation → settlement
```

**The portfolio demonstration is simultaneity, not features.** The same event must appear in
five surfaces at once — merchant dashboard, operations console, rider app, customer tracking
page, financial dashboard. That is only possible if the module boundaries held, which makes it
the acceptance test for the _architecture_, not just the product. A CRUD app cannot demonstrate
it; neither can a working system that only one surface can see.

**Architecture in one line:** modular monolith, one deployable, many internal domains.
Microservices are an extraction strategy, never a starting point. Three backend entrypoints
(`main.ts` API · `worker.ts` BullMQ+NATS · `publisher.ts` outbox) from **one** module graph —
never duplicate a domain module per process, import it.

**Five rules that gate every phase** (full text in [AGENTS.md](AGENTS.md)):

1. PostgreSQL is the only source of truth. Redis and NATS are never authoritative.
2. A module owns its schema — no cross-module JOINs, no foreign repositories, no raw SQL
   crossing a boundary. Cross-module = injected service or event.
3. Pure `rules/` files import nothing from the framework — no `@nestjs/*`, no `typeorm`, no
   decorators. Enforced by the checker on the directory name.
4. Money is integer minor units + currency, `bigint` columns, integer arithmetic. Never float,
   anywhere, including tests.
5. `synchronize: false` permanently. Every schema change is a reviewed migration; never edit an
   applied one.

Two more that bite in practice: **every mutation writes an outbox row in the same transaction**
(the publisher is the only thing that talks to NATS — NATS says _what happened_, BullMQ _does
the work_), and **`Idempotency-Key` is mandatory** on shipment create, bulk import, COD collect,
delivery confirm, settlement approve, rider offline sync.

**Phase state** — 154 ticked, 113 unticked. A checkbox is ticked only when a test, migration or
command proves it.

| Phase                                             | State                                                           |
| ------------------------------------------------- | --------------------------------------------------------------- |
| 0 — Foundation (repo, docs, ADRs, infra, fakes)   | ✅ done                                                         |
| 1 — Foundation domain (identity→shipment→pricing) | 🔄 pricing shipped, spine proven live                           |
| 2 — Logistics (pickup, rider, hub, delivery)      | ✅ exit gate green — section boxes partly stale, audit pending  |
| 3 — Finance (cod, ledger, settlement)             | 🔄 collect→ledger→settle→approve live-proven                    |
| 4 — Platform (API, webhooks, bulk, notifications) | 🔄 exit gate green; risk + support scoped, not started          |
| 5 — Advanced logistics (routing, SLA, offline)    | 🔄 rungs 1–3 done; offline server contract done, device app not |
| 6 — Operations (control tower, analytics, load)   | 🔄 rungs 1–6 shipped; reliability drills + desktop open         |

**Planned surfaces** — ten rows in [surfaces.md](docs/product/surfaces.md). **Six** exist as
packages/apps. The rest do not:

| Surface                  | Package                            | Built                                                                                    |
| ------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| Merchant Web             | `apps/frontends/merchant-web`      | 🟢 solid (console, login, shipments list+detail, new shipment form, cursor pagination)   |
| Operations Control Tower | `apps/frontends/control-tower`     | 🟢 app package exists with map projection                                                |
| Hub Console              | `apps/frontends/hub-console`       | 🟢 app package exists (scan-first dock ops, manifests)                                   |
| Rider Mobile             | `apps/mobile-rider`                | 🟢 Expo shell + auth/jobs/job-detail/sync/profile screens over the proven `OfflineQueue` |
| Customer Tracking        | `apps/frontends/customer-tracking` | 🟢 public, no session                                                                    |
| Support Console          | `apps/frontends/support-console`   | 🔴                                                                                       |
| Admin Console            | `apps/frontends/admin-console`     | 🔴                                                                                       |
| Developer Portal         | `apps/frontends/developer-portal`  | 🔴                                                                                       |
| Desktop                  | `apps/desktop`                     | 🔴                                                                                       |
| Landing + docs site      | `apps/site`                        | 🟢 Astro docs: 6 catalogs + generated API reference                                      |

---

## 2. What just landed — the API contract, secure web auth, and the rider rebuild

Three arcs, all committed and green. `pnpm verify`: **1902 backend · 36 api-client · 25 rider · 8 merchant-web · 41 fakes**, plus `pnpm api:check` (spec and generated client are current) and all 10 packages building.

| Arc          | What it did                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenAPI**  | The spec went from 27 request-only schemas to **145** covering **88 operations**. Every operation now documents its response schema, its error envelope, its parameters, its security schemes, its scopes (`x-required-scopes`, read straight off the `ScopeGuard` instance so there is no second copy to drift) and its rate-limit bucket. `packages/api-client` is 100% derived from it — 32 hand-declared response shapes deleted. `src/openapi.spec.ts` adds 378 assertions that run in `pnpm test`, so the spec cannot go stale again unnoticed. |
| **Web auth** | The three consoles held a bearer token in `sessionStorage`. Now an `HttpOnly; Secure; SameSite=Lax` cookie behind a same-origin `/api` proxy, with the auth guard in `beforeLoad` (307 before any HTML ships, not a flash of console then a redirect). `POST /v1/auth/token` added for clients that cannot hold a cookie.                                                                                                                                                                                                                             |
| **Rider**    | Real persistence (AsyncStorage for the queue, SecureStore for the token), React Navigation, NetInfo-driven auto-sync with backoff and jitter, and 25 tests. The offline core was already right — only the shell around it was a demo.                                                                                                                                                                                                                                                                                                                 |

**Membership management** also landed: `POST/PUT/DELETE /v1/merchants/:id/members`, a `members:manage` scope (migration 0048), and two fail-closed rules — a merchant cannot grant a platform role, and the last owner cannot be removed or demoted. Both the removal and the role-change path revoke the target's sessions, which is what `revokeSessionsForUser` was written for and previously had no caller to serve.

### Bugs the shots and the browser found that tests did not

1. **`credentials: 'omit'` on the login client.** It tells the browser not to send cookies AND not to store any the response sets — so login returned 201, the console navigated to `/app` as if it worked, and the SSR guard bounced straight back to `/login`. Every post-login screenshot was of the login page and nothing reported an error. The comment on `api.ts` warned about exactly this while the code did it.
2. **`useOpenJob()` called above the stack that owns the route.** `useNavigation()` there resolves to the Tabs navigator, which has no `Job` route; `navigate` is accepted and dropped without a warning. Tapping a job card did nothing at all — which is why the mobile shots script only ever captured 3 of 11 screens.
3. **An optimistic update that wrote every row.** `map` set all three notification switches to the same value instead of the tapped one, so the screen disagreed with the database. Caught by a screenshot showing all three off while `merchant_preferences` still had two enabled. The pure logic now lives in `src/rules/` with a regression test, per the AGENTS.md convention.

Lesson, recorded because it recurs: **a passing screenshot pipeline is worth more than a passing test suite for this class of bug.** All three were invisible to `tsc` and to the unit tests, and each was found by looking at an image or a live page.

## 3. Ongoing — what is in flight right now

### Live right now (background processes, not durable)

| Service                | Port | Notes                                                         |
| ---------------------- | ---- | ------------------------------------------------------------- |
| Backend API            | 3000 | `dist/main.js`                                                |
| Worker (BullMQ + NATS) | 9090 | Consumes the event stream — **needed** for tracking timelines |
| Publisher (outbox)     | 9091 | The only process that publishes to NATS                       |
| Web dev server         | 5173 | `merchant-web` — landing, login, console                      |
| Tracking dev server    | 5174 | `customer-tracking` — public `/track`, no session             |

The API alone is not enough. `tracking.public_timeline` is a **projection built by the worker**,
so without `worker.js` running, `/track/:code` 404s for a freshly created shipment. This cost
real time to diagnose.

Seeded credentials (`ops+muyc0amh@ayesha.test`) live in env only, never committed. Reset with
`SEED_CONSOLE_EMAIL` / `SEED_CONSOLE_PASSWORD`.

### Where the web layer actually stands

Built: landing · login · control tower · shipments list · shipment detail · **new shipment form** (`shipments.new.tsx` with coverage check, debounced quotes, and idempotency key) in `merchant-web`; cursor pagination via `cursorStack.ts`; **public parcel tracking** in `customer-tracking` (`/track`, no session); **hub-console** app (`apps/frontends/hub-console`) for scan-first dock ops; **control-tower** app (`apps/frontends/control-tower`); **reliability drills** integration test suite (`reliability-drills.integration.test.ts`).

**Known thin, deliberately:**

- `useAsync` has no cache and no request dedupe — every mount refetches. It is one hook doing
  one job for four screens. **Add `@tanstack/react-query` when a second screen needs the same
  list, or when a mutation must invalidate something a screen fetched.** Not before.
- Server loaders are still thin. The auth guard runs in `beforeLoad` on the server now, but the
  screens themselves fetch client-side through `useAsync`, which has no cache and no request
  dedupe. Add `@tanstack/react-query` when a second screen needs the same list, or when a mutation
  must invalidate something a screen fetched — not before.
- `apps/mobile-rider` has AsyncStorage + SecureStore persistence, React Navigation, NetInfo
  auto-sync, and 25 tests. **Native does not bundle here**: `expo export --platform ios` fails inside
  `react-native-screens`' Fabric component, so `build` is web-only. See `apps/mobile-rider/README.md`.

### What was just proven and verified (2026-10-09)

1. **`list-webhook-deliveries.spec.ts` unit tests added & passing**:
   - 9 test cases in [list-webhook-deliveries.spec.ts](file:///home/meaow/cook/zipzap/apps/backend/src/modules/merchant/list-webhook-deliveries.spec.ts) covering tenant isolation, keyset pagination (`id < cursor`), limit clamping `[1, 200]`, endpoint filter, and null conversions.
   - All backend unit tests pass: **1,366 tests passed across 64 test files**.
2. **`@zipzap/rider` device queue & client proof**:
   - [verify-queue.mjs](file:///home/meaow/cook/zipzap/apps/mobile-rider/scripts/verify-queue.mjs) passes: 19 assertions ok verifying monotonic sequence, ordered replay, queue capacity warning at 90%, hard refusal at 100%, and server reconciliation.
   - [verify-client.mjs](file:///home/meaow/cook/zipzap/apps/mobile-rider/scripts/verify-client.mjs) passes: proves `RiderClient` lifecycle (offline queueing for delivery + pickup, replay flush, server ruling reconciliation).
   - [packages/api-client](file:///home/meaow/cook/zipzap/packages/api-client/src/index.ts) updated with `pullRiderSync`, `ackRiderSync`, and `replayRiderSync` typed methods.

3. **Developer portal & webhooks screen landed**:
   - Added `WebhooksScreen` (`/app/webhooks`) in `merchant-web` with endpoint registration (displaying secret once), active endpoints table, delivery attempt log with terminal status / attempt counter, and 1-click delivery replay.
   - Wired to console navigation bar under Operate.
   - Extended `ZipZapClient` in `@zipzap/api-client` with typed `listWebhooks`, `createWebhook`, `listWebhookDeliveries`, and `replayWebhookDelivery`.
   - Passes `pnpm verify` with full turbo caching.

### What was just proven and verified — rider shell (2026-10-09, later)

4. **Rider mobile app shell landed (`apps/mobile-rider`)**:
   - Expo 52 + React Native 0.76 + TanStack Query 5 app: auth (email/password → `/v1/auth/login` bearer token), today's-jobs feed (merged pickups + deliveries from `riderJobs`), job detail (pickup scan, failed-attempt with the server's closed reason vocabulary, complete-with-COD in integer poisha), sync screen (pending queue with believed-state, settled rulings, cap warning, one-tap `sync()`), profile (`getMe` session check + queue summary + sign-out).
   - Every write appends to the proven `OfflineQueue` and returns immediately — no screen waits on the network. `RiderClient` gained `recordDeliveryAttempt` and `recordCodCollection` alongside the existing `recordDelivery`/`recordPickup`/`sync`.
   - Shared `theme.ts` + five primitives (`Card/Title/Muted/Button/Field/Badge`) + `TabBar` with a pending-count badge. `useFocusEffect` shim stands in for a router until one lands.
   - `pnpm verify` green: rider typecheck + 19-assertion queue proof + client lifecycle proof + 1,366 backend tests.

### Next, in the order the roadmap implies

1. **Airplane-mode day drill** — run the rider app against a live backend with the signal off, and prove a scan survives, replays, and resolves. The queue's guarantees are unit-tested; the integration with AsyncStorage on a device is not, and the native bundle does not currently build to test it.
2. **Complete reliability drill scenarios** — Extend [reliability-drills.integration.test.ts](file:///home/meaow/cook/zipzap/apps/backend/test/integration/reliability-drills.integration.test.ts) to cover process kill (worker/publisher) and provider outages.
3. **Phase 1 identity finish** — account suspension (a membership can be removed but not disabled), session fingerprinting, and the argon2id password upgrade.
4. **Docs site content** — the catalogs are seeded but thin (one page each for rider, hub, operations, FAQ).

### Blockers and traps — do not re-learn these

- **`packages/api-client` resolves from `dist/`, not `src/`.** Edit `src/` and the app keeps
  the old build. Run its `tsc -p` before concluding a web type error is real.
- **Editor stale buffers silently revert writes** to `Button.tsx`, `Checkbox.tsx`,
  `Pagination.tsx`, `SearchInput.tsx` — Write and SearchReplace report success, `cat` shows old
  content. Close and reopen those files if an edit appears not to land.
- **Read/grep/glob tools were unavailable for a long stretch of the previous session.** The
  fallback is `RunCommand` with `cat`/`sed`. If those tools error with _"not available in given
  tool list"_, that is a tooling outage, not a `.trae/.ignore` problem — do not go hunting for
  an ignore file.
- **`psql` is not installed.** Use `docker exec zipzap-postgres-1 psql -U "$DBU" -d zipzap`;
  the Docker role is `zipzap`, not `postgres`.
- **GPG signing fails in the sandbox** (`EACCES` on `~/.gnupg`). Use
  `git -c commit.gpgsign=false commit`.
- **Node 24 + pnpm live under fnm**, not on the default `PATH`:
  `export PATH="$HOME/.local/share/fnm/node-versions/v24.16.0/installation/bin:$PATH"`.
  System Node is v18 and Storybook refuses it.
- **Playwright browsers**: the MCP server wants `chromium-1200`, only `chromium-1243` is
  installed. The shot scripts bypass this with a global `playwright-core` and
  `executablePath: /usr/bin/google-chrome` — no project dependency added, deliberately.

### Environment debt — worth fixing, nobody has

- **The GitHub repo is `PRIVATE`.** `origin` is `git@github.com:mahabubone/zipzap.git`. Everything
  described in this file is invisible to anyone who is not you, which defeats the point of the
  exercise. `gh repo edit --visibility public` is the highest-ROI command available to this repo.
- **[OLD note, superseded]** commits were unpushed at one point. `origin` is configured and the
  branch tracks it. **Push before sharing a link.**
- **`ROADMAP.md` line "apps/ holds `backend` only" is stale**, and `docs/product/surfaces.md`'s
  surface list is now honest but mostly unbuilt: `support-console`, `admin-console`,
  `developer-portal` and `apps/desktop` have no package. `control-tower` and `hub-console` exist.
- **Phase 2's section boxes are marked stale in ROADMAP itself** and still need an audit.
- **113 unticked roadmap boxes**, concentrated in surfaces, security (6, none started),
  observability dashboards/alerts, and load-test phases.

---

## 4. How to verify you are reading this against reality

```bash
export PATH="$HOME/.local/share/fnm/node-versions/v24.16.0/installation/bin:$PATH"
pnpm infra:up        # postgres :5433 · redis :6381 · nats :4224 (ports are in .env)
pnpm db:migrate
pnpm verify          # boundaries:check && format:check && typecheck && test — must be green
pnpm test:integration   # 106 assertions against real Postgres/Redis/NATS
```

Last run: **2,396 unit tests across 115 files** — backend 1,913 · ui 338 · rider 93 ·
api-client 36 · control-tower 8 · merchant-web 8 — plus **106 integration assertions**. Green.

> An earlier version of this file claimed 1,188 across 51 files. It was stale, and it
> understated the suite by 60%. Corrected 2026-10-12 — if you are comparing numbers against
> older notes, this line is the one that moved.

> **`pnpm test:integration` had never run.** CI invokes it, but no package defined the turbo task,
> so turbo refused to dispatch it. Running it exposed three hand-wired DI graphs that had drifted
> out of date and two production bugs — see [ADR-0017](docs/ADR/0017-integration-test-harness.md).

Two scripts assert what the terminal cannot:

```bash
# Drives the real client against a running backend and asserts decoded values.
SEED_CONSOLE_EMAIL=... SEED_CONSOLE_PASSWORD=... \
  node apps/frontends/merchant-web/scripts/verify-client.mjs

# Measures rendered geometry — a page that silently loses its CSS still
# returns 200 with all its copy intact.
PLAYWRIGHT_CORE=<path>/playwright-core/index.js \
  node apps/frontends/merchant-web/scripts/verify-marketing.mjs

# Public tracking, in its own app. Needs TRACKING_CODE.
TRACKING_CODE=ZP-... PLAYWRIGHT_CORE=<path>/playwright-core/index.js \
  node apps/frontends/customer-tracking/scripts/verify-tracking.mjs

# Recaptures shots/ after any visible change. Covers both web apps.
PLAYWRIGHT_CORE=<path>/playwright-core/index.js \
  SEED_CONSOLE_EMAIL=... SEED_CONSOLE_PASSWORD=... TRACKING_CODE=ZP-... \
  node apps/frontends/merchant-web/scripts/shots.mjs
```

`shots/` is the visual memory — after any visible change, capture fresh ones. It is the
fastest way to see what the product looks like without booting the stack.

---

## 5. Rules of the road, condensed

From [AGENTS.md](AGENTS.md). Full text there; these are the ones that get violated by accident.

- **Read before you touch.** `docs/architecture/overview.md` for anything,
  `docs/domains/<module>.md` for a domain, `docs/ADR/` for an architectural choice. If it isn't
  recorded, record it.
- **Explicit `@Inject()` on every constructor param.** esbuild (Vitest's transformer) cannot
  emit decorator metadata, so bare params resolve `undefined` under Vitest while working under
  `tsc`. If a service works in `pnpm dev` and is `undefined` in `pnpm test`, this is why.
- **A provider's wire format never leaves `<module>/provider/`.** No `'status_code'` or
  `'1250.50'` in a rules, service or controller file.
- **State transitions are validated.** A status column is never `UPDATE`d directly.
- **Append-only where it is history.** Tracking events, ledger entries, audit rows, webhook
  delivery logs. Corrections are new compensating rows.
- **Never log:** password, API secret, token, webhook signing secret, full payment credential.
- **New module** → `docs/domains/<module>.md` + an ADR if it changed a boundary.
- **New table or column** → a migration + an update to `docs/architecture/database.md`.
- **Touching money or a state machine** → add a unit test. Not optional.
