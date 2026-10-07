# state.md

Working context for whoever picks this up next — including a future agent with no memory of
the conversation that produced it.

**This file is not the source of truth.** `docs/` is. Where the two disagree, `docs/` wins and
this file is the bug. Sourced from [`ROADMAP.md`](ROADMAP.md), [`docs/product/vision.md`](docs/product/vision.md),
[`docs/product/surfaces.md`](docs/product/surfaces.md), [`AGENTS.md`](AGENTS.md) and `git log`.

**Last updated:** 2026-10-07 · **Where:** one web app of ten planned surfaces, partially built · **Verify:** `pnpm verify`

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

**Planned surfaces** — ten rows in [surfaces.md](docs/product/surfaces.md), and **one** of them
exists as a package. This is the single biggest gap in the repo. Note that none of the
`apps/frontends/*` paths in that table exist on disk: the merchant console was built in
`apps/web` instead, so the doc and the repo disagree:

| Surface                  | Package                            | Built                                        |
| ------------------------ | ---------------------------------- | -------------------------------------------- |
| Merchant Web             | `apps/web`                         | 🟡 partial                                   |
| Operations Control Tower | `apps/frontends/control-tower`     | 🔴 folded into `apps/web`                    |
| Hub Console              | `apps/frontends/hub-console`       | 🔴                                           |
| Rider Mobile             | `apps/mobile-rider`                | 🔴                                           |
| Customer Tracking        | `apps/frontends/customer-tracking` | 🟡 public `/track/:code` API exists, no page |
| Support Console          | `apps/frontends/support-console`   | 🔴                                           |
| Admin Console            | `apps/frontends/admin-console`     | 🔴                                           |
| Developer Portal         | `apps/frontends/developer-portal`  | 🔴                                           |
| Desktop                  | `apps/desktop`                     | 🔴                                           |
| Landing + docs site      | `apps/site`                        | 🟡 landing page in `apps/web`, no Astro site |

---

## 2. Recent mission — what just happened

**Mission: take the UI kit from "component library" to "product you can sign into",**
backend-first as the user chose — the API and its types before the screens that read them.

Landed in six commits, oldest first:

| Commit    | What it did                                                                                                                                                                                                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `2ae4618` | **Backend unblock.** `keys:manage` existed in TypeScript but no migration taught Postgres the enum value, so every seed died. Added migration `0033`. Separately `live-counts` 500'd on every call: `sumOutstandingCODMinor` correctly returns `bigint` per the money rule, and it flowed straight into `JSON.stringify`. Now serialised at the controller edge as a decimal string. |
| `3a134d7` | **UI kit full pass.** `DataTable` (sort/filter/paginate/select/hide-columns on `@tanstack/react-table`), `AppShell`, `Pagination` + the atoms and molecules they needed.                                                                                                                                                                                                             |
| `c215579` | **Shots.** The visual-memory convention, captured and committed.                                                                                                                                                                                                                                                                                                                     |
| `4e07f87` | **api-client types.** Controllers return interfaces, not decorated DTOs, so `openapi-typescript` had no schema and every method returned `unknown`. Hand-declared 6 response shapes read off live responses.                                                                                                                                                                         |
| `c076c22` | **The console.** Auth guard, shell, control tower, shipments table, shipment detail, parcel tracking.                                                                                                                                                                                                                                                                                |
| `d96c92c` | **Marketing.** Landing page, split-panel login, brand mark.                                                                                                                                                                                                                                                                                                                          |

**Four bugs the browser found that typecheck could not.** Worth keeping, because every one of
them passed `tsc`, passed SSR, and was invisible from the terminal:

1. **Unbound `fetch`.** `this.fetchImpl = options.fetchImpl ?? fetch` stored the bare function
   and invoked it as a method, so every browser call threw _"Illegal invocation"_. Login was
   impossible. `tsc` was happy; the curl-based checks passed because they never ran a browser.
   Now `fetch.bind(globalThis)`, with a regression test that throws when the receiver is wrong.
2. **`next_cursor` vs `nextCursor`.** The API sends camelCase; the client read snake_case, so
   every page of shipments silently paginated wrong. **My own contract test had encoded the bug
   as the expected shape** — a test written from the implementation instead of from the spec.
3. **Tailwind never scanned `apps/web`.** v4 auto-detects sources from the _stylesheet's_
   directory — `packages/ui/src` — so it shipped theme variables with zero utilities and the
   console rendered as unstyled HTML. Fixed with an explicit `@source`.
4. **`.ts` importing a `.tsx`.** `tsc` resolves it via `rewriteRelativeImportExtensions`;
   **Vite does not.** SSR fell back to client rendering with an empty body.

Lesson, recorded because it recurred: **SSR succeeding proves nothing about a client-rendered
app.** Curl the HTML and you get a 200 and the right copy while the screen is blank.

---

## 3. Ongoing — what is in flight right now

### Live right now (background processes, not durable)

| Service                | Port | Notes                                                         |
| ---------------------- | ---- | ------------------------------------------------------------- |
| Backend API            | 3000 | `dist/main.js`                                                |
| Worker (BullMQ + NATS) | 9090 | Consumes the event stream — **needed** for tracking timelines |
| Publisher (outbox)     | 9091 | The only process that publishes to NATS                       |
| Web dev server         | 5173 | TanStack Start, Vite                                          |

The API alone is not enough. `tracking.public_timeline` is a **projection built by the worker**,
so without `worker.js` running, `/track/:code` 404s for a freshly created shipment. This cost
real time to diagnose.

Seeded credentials (`ops+muyc0amh@ayesha.test`) live in env only, never committed. Reset with
`SEED_CONSOLE_EMAIL` / `SEED_CONSOLE_PASSWORD`.

### Where the web layer actually stands

Built: landing · login · control tower · shipments list · shipment detail · parcel tracking.

**Known thin, deliberately:**

- `useAsync` has no cache and no request dedupe — every mount refetches. It is one hook doing
  one job for four screens. **Add `@tanstack/react-query` when a second screen needs the same
  list, or when a mutation must invalidate something a screen fetched.** Not before.
- The shipments list is a flat 100-row page. Cursor pagination exists in the API and is _not_
  wired to the table yet.
- No create-shipment form. The API supports it (with mandatory `Idempotency-Key`); the console
  cannot do it yet.
- Session lives in `sessionStorage`, so SSR cannot read it. Fine for a session-token console;
  it is the reason there are no server loaders.

### Next, in the order the roadmap implies

1. **Customer tracking page** (`apps/frontends/customer-tracking`). The public API is already
   there and unauthenticated — this is the cheapest missing surface and it completes a fifth
   projection of the same events. Highest value per line written.
2. **Rider mobile app** (`apps/mobile-rider`). The _server_ contract is done and proven —
   ordered replay, explicit rejection of commands invalidated while offline, idempotent acks.
   The device half is unstarted. Phase 5's exit gate cannot pass without it.
3. **Hub console** — scan-first, designed for a loading dock. Fills the operations gap.
4. **Reliability drills.** Every scenario in [docs/operations/reliability.md](docs/operations/reliability.md)
   induced and asserted: Postgres down, Redis down, NATS down, publisher killed, worker killed,
   duplicate event, duplicate request, rider reconnect, duplicate settlement. Phase 6 rungs 7–8.

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

- **No git remote.** `git remote -v` is empty. 20+ commits exist on this machine only. First
  push publishes them; `main` is public by default on a new GitHub repo.
- **`docs/product/surfaces.md` disagrees with the repo.** It lists `apps/frontends/*` paths that
  do not exist; the console was built in `apps/web`. Either move the app or fix the doc — and
  `ROADMAP.md` line "apps/ holds `backend` only" is now stale too.
- **Phase 2's section boxes are marked stale in ROADMAP itself** and still need an audit.
- **113 unticked roadmap boxes**, concentrated in surfaces (7 of 10 unbuilt), security (6, none
  started), observability dashboards/alerts, and load-test phases.

---

## 4. How to verify you are reading this against reality

```bash
export PATH="$HOME/.local/share/fnm/node-versions/v24.16.0/installation/bin:$PATH"
pnpm verify          # format:check && typecheck && test — must be green
```

Last run: **1188 backend tests across 51 files**, plus the api-client suite. Green.

Two scripts assert what the terminal cannot:

```bash
# Drives the real client against a running backend and asserts decoded values.
SEED_CONSOLE_EMAIL=... SEED_CONSOLE_PASSWORD=... node apps/web/scripts/verify-client.mjs

# Measures rendered geometry — a page that silently loses its CSS still
# returns 200 with all its copy intact.
PLAYWRIGHT_CORE=<path>/playwright-core/index.js node apps/web/scripts/verify-marketing.mjs

# Recaptures shots/ after any visible change.
PLAYWRIGHT_CORE=<path>/playwright-core/index.js \
  SEED_CONSOLE_EMAIL=... SEED_CONSOLE_PASSWORD=... node apps/web/scripts/shots.mjs
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
