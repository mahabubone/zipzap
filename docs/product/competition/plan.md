# Competitive plan — parity as a network operator

How ZipZap closes the gap recorded in [_index.md](_index.md). Research baseline: 2026-10-08.

This plan **references** [ROADMAP.md](../../ROADMAP.md) phase gates; it does not rewrite them. Where
the two disagree, `ROADMAP.md` is stale and this file says so explicitly.

## Decisions this plan is built on

Recorded here because every one of them closes off an alternative, and a plan that does not say what
it decided cannot be reviewed.

| Decision     | Choice                                      | Consequence                                                                                    |
| ------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Position     | **Own courier network**                     | Rider app, hub console and live map are mandatory, not deferred. This is the expensive choice. |
| Segment      | **API-first, no store plugins or adapters** | No Shopify/WooCommerce work ever. Distribution is our own panel plus the generated client.     |
| Goal         | **Skill-proof showcase**                    | Optimised for production completeness, not for shipping a narrow slice fast.                   |
| Order        | **By surface, gap-driven within each**      | Every step ends in a runnable screen.                                                          |
| Plan home    | **This file**                               | `ROADMAP.md` keeps its history.                                                                |
| Accounts     | **Staff roles + multi-business**            | Phase 1 identity must be finished first. There is no cheap path.                               |
| Rider app    | **Offline-first, airplane-mode gate**       | Phase 5's gate is the finish line, not a stretch goal.                                         |
| Map          | **PostGIS, live positions**                 | The one row where we beat all three rather than match them.                                    |
| Network data | **Demo-seeded**                             | No rider self-onboarding, no hub-manager signup, no KYC.                                       |
| Excluded     | **Helpdesk and plugins**                    | No support console, no ticket module, no live chat.                                            |

### The gap, stated honestly

The backend is complete. The merchant console is **read-only** — six routes, no create form, no
mutation buttons, cursor pagination unwired — while the API behind it already does create, cancel,
hold, release, bulk import, pickup, returns, COD and settlements.

> **~90% of shipped business capability has no screen.** Every row marked "backend only" in
> [_index.md](_index.md) §1 is code with no user.

That is the whole problem. It is not an architecture problem, and no ADR will fix it.

---

## Ordering

Surface by surface. Within each surface, close the competitive gaps it owns. Nothing starts before
the thing beneath it is real.

```
Stage 0  Identity and security          ← everything else depends on this
Stage 1  Merchant web                   ← the 90% gap. The four gaps' biggest payoff.
Stage 2  Settlement and money surfaces  ← gap 1, the market's weakest point
Stage 3  Hub console                    ← we now operate hubs
Stage 4  Rider app, offline-first       ← the offline gate
Stage 5  Ops console + live map         ← the differentiator
Stage 6  Public tracking + dev portal   ← gaps 2 and 4
Stage 7  Parity sweep                   ← the scorecard, row by row
```

Each stage names its own exit check. A stage is done when its check runs green, not when its boxes are
ticked — `ROADMAP.md`'s own rule, and the reason its Phase 1 boxes are currently untrustworthy.

---

## Stage 0 — Identity and security

**Nothing else starts here.** Multi-business and staff roles sit directly on `identity`, and
retrofitting tenancy under three live surfaces costs more than building it first.

| Work                                                                            | Source                                                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Role bundles as code** — seven roles, guards check scopes never role names    | ✅ **done**, [identity/rules/roles.ts](../../../apps/backend/src/modules/identity/rules/roles.ts) |
| **A human session gets its role's scopes, not every scope**                     | ✅ **done** — this was a live bug                                                                 |
| Two principal kinds — a machine API key must never open a browser session       | ✅ already true                                                                                   |
| Tenant scoping derived from the principal                                       | ✅ already true — `assertTenant` returns 404, not 403                                             |
| Rate limiting fails **closed on writes**, open on reads                         | ✅ already true                                                                                   |
| `REQUEST_ID` propagated edge → log → span                                       | ✅ **done** — middleware, validated header, response echo                                         |
| Audit events: login, failed login, logout, credential minted                    | ✅ **done** — `system.audit_events`, append-only by trigger                                       |
| Customer-data reads audited, not merely restricted                              | ✅ **done** — `GET /v1/shipments/:id`, the only read that returns PII                             |
| `identity.users` — one login per person, many per merchant                      | ✅ **done** — migration 0036, backfilled from every merchant that had a password                  |
| Multi-business: orders, stores, invoices and analytics nest under a business id | ✅ **done** — `merchant_id` kept, not renamed; a membership carries the role                      |

**Audit corrections.** Reading the code before building changed three rows of this stage:

| This plan originally said              | Reality                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Argon2id is the only password hash"   | `common/secret.ts` uses **scrypt** with a documented rationale: memory-hard, zero dependencies, and the ~70 ms cost is _deliberately_ spent as the login rate limiter. Argon2's edge is GPU resistance, which an online guessing surface does not need. **The doc was corrected, not the code.** |
| "identity schema migration"            | [identity.module.ts](../../../apps/backend/src/modules/identity/identity.module.ts) deliberately registers **no TypeORM connection**. Sessions and API credentials are merchant's tables, with a written rationale. Moving them would be a boundary change with no security benefit.             |
| "Rate limiting fails closed on writes" | Already implemented in [rate-limit.guard.ts](../../../apps/backend/src/modules/identity/rate-limit.guard.ts), with the reasoning inline. `ROADMAP.md`'s unticked box is stale.                                                                                                                   |

**The bug this stage found.** Every human session was issued `[...API_SCOPES]` — all fifteen,
including `settlements:approve` and `keys:manage`. One shared merchant password meant one
omnipotent console login per merchant, and a stolen token could approve a settlement and mint
itself a fresh API key. The role now lives on the **membership** and is mapped to a bundle at
authentication; `MERCHANT_OPERATOR` cannot reach either scope.

### Exit check

Runnable, not ticked: [stage0-exit-check.spec.ts](../../../apps/backend/src/modules/identity/stage0-exit-check.spec.ts).
**Five for five.**

- [x] An API key cannot obtain a browser session, and a session cannot call an API-only scope
- [x] Two operators on one merchant hold different permissions; the denied one gets 403 **without**
      leaking the resource's existence
- [x] One login can act inside two businesses and cannot read the third — proven by test, per module
- [x] Argon2id is the only password hash in the database; a timing test on signature compare is in CI
      → **reworded**: scrypt only, per `docs/domains/identity.md` rule 2; `timingSafeEqual` is
      already the only comparison path and `verifySecret` is unit-tested against a malformed
      stored value
- [x] A write under rate limit returns 429, and the limit cannot be bypassed by retrying

**What closing assertion 3 actually cost.** `identity.users` + `identity.user_merchants`
(migration 0036), and three things the plan had not anticipated:

1. **identity now owns tables, so it owns a TypeORM connection.** It registered none until now,
   because a person's password hash lived on `merchant.merchants` — which is exactly why one login
   could not hold two businesses. The credential that proves who you are was the same row that
   scoped what you could see.
2. **`role` had to move to the membership, and with it the session's copy was deleted.** A role per
   user cannot express "operator at one store, owner at another". Dropping `sessions.role` rather
   than nulling it also removed the weaker property it carried — rotate-on-privilege-change — which
   is now replaced by a stronger one: permissions resolve from the membership **per request**, so a
   revoked membership dies on the next call with no re-login.
3. **The `merchantId` a client sends is a request for a scope, not an assertion of one.** A business
   the user does not hold fails the login instead of falling back to the default, because a
   fallback serves the wrong store's data with a 200.

Verified against a live database, not only in unit tests: one login reached two businesses with
**different scopes in each** (owner: `settlements:approve` + `keys:manage`; operator: neither), a
third business was refused, and wrong-password / unheld-business / unknown-email all returned an
identical 401.

**What running the check found that reading it would not have.** `assertTenant` was dead code —
defined, documented as _the_ tenancy enforcement, unit-tested, and called from zero production
sites. Real tenancy was implicit: eighteen controllers read `principal.merchantId` and passed it
into a `WHERE`. It is membership-based now and still has no production caller, which is recorded
here rather than papered over: the predicate is `assertTenant`, the call sites pass the principal's
active `merchantId`, and neither of those is a place a caller can supply an id of their own. A
future endpoint that takes a merchant id from the body must call it.

`ponytail:` no invitation flow, no role-assignment UI, no password reset, and no switch-business
endpoint. A second login with `merchantId` reaches the other business, which proves the model and
is not yet a good console. All three are Stage 1 console work.

---

## Stage 1 — Merchant web

The 90% gap, and the highest payoff in the plan. Everything here is a screen over an endpoint that
already works.

### 1a. Create a shipment ✅

`POST /v1/shipments` exists and takes a mandatory `Idempotency-Key`. The form needs: sender name,
phone, address · recipient name, phone, address · weight in grams, description · COD amount and
currency · zone, remote-area and fragile flags · merchant plan. All of it is already in
[create-shipment.controller.ts](../../apps/backend/src/modules/shipment/create-shipment.controller.ts).

- The phone fields must normalise to E.164 on the client — the server regex is
  `/^\+8801[3-9]\d{8}$/` and a Bangladeshi merchant typing `017…` will be rejected by it
- Zone and serviceability checked before submit: `GET /v1/coverage?zone=` already answers
- **A quote preview before commit.** `POST /v1/pricing/quote` is version-frozen; showing the
  merchant what they are about to be charged is the RedX/Steadfast calculator parity row

**Proven in a browser: 38 assertions, and the form had never been seen by anyone.** Typed
`01711223344` (the server regex rejects it), watched the estimate itemise a base fee and a weight
surcharge **before** submitting, confirmed nothing was written merely by quoting, committed, and
read the row back out of Postgres. The confirmation panel deliberately does **not** auto-navigate —
it shows the tracking code and offers _Open shipment_ — because a merchant creating five parcels in
a row should not be thrown out of the form on the first one. A proof that waited for the navigation
would have read that as a failure; it is the correct behaviour.

**One real bug, and it is the one this row exists to catch.** The form converted the COD field with
`Math.round(Number(x) * 100)` — a float round-trip on money, which rule 4 forbids outright. For a
two-decimal amount it happens to be exact, which is why nobody noticed. For a **third** decimal it is
not merely imprecise but _inconsistent_: `1.005` is stored as `1.00499999999999989` and rounded
**down** to 100 poisha, while `8.115` is stored as `8.115000000000000213` and rounded **up** to 812.
The direction came from the binary representation of that particular number, not from what the
merchant typed. Now parsed as digits by [money.ts](../../apps/frontends/merchant-web/src/lib/money.ts),
with no float in the path, and a third decimal is **refused with a reason shown under the field**
rather than rounded away — a COD is collected in cash by a rider, so ৳1,250.555 is not an amount
anyone can hand over and silently charging ৳1,250.55 hides the typo instead of showing it.

`verify-money.mjs` sweeps 200,000 whole amounts × 12 cent values — every two-decimal figure under
৳200,000 is exact to the poisha — and asserts the old expression's rounding directions directly, so
"simplifying" it back cannot pass unnoticed.

### 1b. Bulk import ✅

Upload → **human preview checkpoint** → accept → chunked → result CSV. The 10,000-row path is
already live-proven at ~96 s. Only the UI was missing. The preview checkpoint is the differentiator
and must not be simplified away — the first upload always has a column-mapping mistake.

**What shipped.** `/app/shipments/bulk`: pick a file (or download a template), see every row the
server will create with its outcome and reason, then Accept. Failures are listed **first** and in
full — a merchant must not scroll past 400 good rows to find the three that failed — and a 10,000-row
file is summarised to 50 rather than rendered as 10,000 `<tr>`. `COMPLETED_WITH_ERRORS` reads as
_Finished_, because a file where 9,997 rows imported and 3 failed is a finished import, not a broken
one. The decisions live in [bulk.ts](../../apps/frontends/merchant-web/src/lib/bulk.ts) and
`verify-bulk-preview.mjs` asserts them, including that **every failure survives the row cap**.

**Three bugs the running found that reading it would not have.**

1. _An unreadable CSV was a 500._ `parseCsv` throws on an unbalanced quote, and `upload` let it
   escape. A merchant with one stray `"` in a 10,000-row file got `INTERNAL_ERROR` and a generic
   "An unexpected error occurred" — the least useful response to the one mistake the preview exists
   to catch. It is now a 400 naming the problem.
2. _The result CSV downloaded as HTML._ Nest returns a bare `string` as `text/html`, so "Download
   result CSV" saved an `.html` file that opened as a broken page. Both `Content-Type: text/csv` and
   `Content-Disposition` are now set — the second is load-bearing too, since the console builds the
   download from a Blob (an `<a href>` cannot carry the `Authorization` header).
3. _`/app/shipments/new` had never worked._ Not introduced here, and not visible from reading any
   file: `shipments.tsx` was the route at `/app/shipments` **and** the parent of `/new`, `/$id` and
   now `/bulk`. A route that renders its own page must also render an `<Outlet />` for its children to
   appear, and it had none — so every child silently rendered nothing and `/app/shipments/new`
   displayed the **list**. The create form compiled, typechecked, had stories' worth of care, and
   **no one had ever seen it**. That is why 1a's exit check below is still unticked despite the form
   existing. Fixed by splitting it: `shipments.tsx` is now the layout, `shipments.index.tsx` is the
   list. It is the argument for proving a screen in a browser rather than by its typechecking.

**A gap the check found rather than papered over.** The backend accepts a ninth column,
`delivery_note`, and the processor never reads it — accepted and silently discarded, the same shape as
`zone` was. The template therefore does **not** offer it: advertising a column that does nothing is
worse than omitting it, because the merchant fills it in and believes it mattered.
`verify-bulk-preview.mjs` asserts the template is a prefix of the backend's own `BULK_COLUMNS`, and
parses the example row **with the backend's parser** rather than `split(',')` — the naive split is
exactly the mistake the preview exists to catch, and using it in the test made the test blame the
template for the test's own bug.

### 1c. Actions on a shipment ✅

Four buttons, four existing endpoints: `POST /v1/shipments/:id/{cancel,exception,hold,release}`. The
`Dialog` component and a "Hold shipment?" story already exist. Each action needs an `Idempotency-Key`
and a typed confirmation where it is irreversible.

**Two of those premises were wrong, and only running them showed it.**

1. _These four take **no** `Idempotency-Key`._ `report-exception.controller.ts` says why in one
   line: _"No Idempotency-Key header: the transition itself is the dedupe."_ The state machine is the
   idempotency layer, so the requirement was to write down and prove the thing that actually
   guarantees it — that the second identical call is a `409 INVALID_TRANSITION` naming both states,
   never a silent second write.
2. _There was nothing to click._ No parcel in the database was in `IN_TRANSIT` or `SORTING`, so
   _report lost_ and _report damaged_ had no valid target. Inserting a row with that status would
   have made a broken advance invisible to a proof about exceptions, so the fixtures are driven there
   through the real journey: pickup requested, rider assigned, parcel scanned, then
   `INBOUND → SORT → OUTBOUND → DEPARTED` at a hub that actually exists — five real transitions per
   parcel, each one the machine's — with `ARRIVED` added for the parcel that goes on to the doorstep.

The proof asserts **the console never offers an action the machine will refuse**, in both directions:
`OUT_FOR_DELIVERY` offers Hold and nothing else, `CREATED` offers Cancel and nothing else,
`IN_TRANSIT` offers both exception reasons and no cancel. After each action the screen refetches
rather than guessing — `ON_HOLD` swaps Hold for Release. Each destructive action gets a typed
confirmation stating the consequence: cancelling says the parcel cannot be resumed and the COD stays
the merchant's to collect; reporting lost says it is excluded from the next settlement run; reporting
damaged says the hub inspects it and that claiming damage you have not checked is fraud.

**A mistake worth recording, because the assertion looked right and was wrong.** The first version
replayed the hold _after_ the release, reasoning that "the parcel was held earlier". By then it was
back in `OUT_FOR_DELIVERY`, so the second hold was perfectly legal and returned `201` — the assertion
failed while appearing to test exactly the right thing. A replay must be issued **while the state is
still the state the action left it in**; that is the whole meaning of the word. All four are now
replayed immediately after the action that set that state.

The proof also cannot be re-run against the same parcels — a cancelled parcel cannot be cancelled
again — so it opens with a preflight that reads each fixture's status and reports _stale fixtures,
run the setup first_ rather than failing four confusing button-count assertions.

### 1d. Cursor pagination, properly ✅

`GET /v1/shipments` returns `{ data, pagination: { nextCursor, hasMore } }`. `DataTable` is
client-side only and carried a `ponytail:` note saying so. Replace it with a cursor-fed table. **The
existing `Pagination` component takes `pageIndex`/`pageCount`** — a page-number API cannot express a
cursor. One of the two has to change; the cursor is the correct end state because the API already
speaks it.

**What shipped.** `DataTable` takes an optional `serverPage` ({ hasMore, canGoBack, onNext, onBack });
when it is set the table stops slicing, sorting and filtering client-side and renders `Newer`/`Older`
instead of page numbers. `Pagination` is untouched and still serves every client-side table, so no
story regressed. The client's half of the walk lives in
[cursorStack.ts](../../apps/frontends/merchant-web/src/lib/cursorStack.ts) because a cursor is
one-way: `Newer` replays a stack of the cursors already used. `useAsync` gained a `key` argument so a
screen whose query is in state refetches without a reload-from-effect double fetch.

**Two things the boxes hid.**

1. _The three controls had to be suppressed, not just the pager._ A `DataTable` fed one server page
   would still have sorted and filtered those 25 rows and shown a search box — each of which reads as
   "this is the whole list, sorted" when it is 25 of 3,000. Suppressing them is why the shipped prop
   takes the paging callbacks rather than a bare `manual` flag.
2. _The exit-check wording was written for a page-number API and does not mean what it says._ "Page 1
   → page 2 → back → page 1 with a shipment created in between shows no duplicate and no skip" is a
   property of **keyset** pagination, and it holds only because the cursor is `(created_at, id)` and
   not an offset. The runnable half is
   [verify-cursor-stack.mjs](../../apps/frontends/merchant-web/scripts/verify-cursor-stack.mjs) — its
   fake server keys its cursor on **row identity, not row index**, because an index cursor drifts the
   moment a row is inserted and the fake would pass where production fails.

**What running it against the live database found that reading it would not have.** The 400 for a
malformed cursor carries only `code` and a generic `detail`: `ValidationFailedError` holds the named
reason ("cursor is not valid base64url JSON") in `issues`, and `toEnvelope` never serialises it. The
reason is therefore unreachable by any client, including the console's own error surface. Left alone
here — it is the envelope's business, not pagination's — but it should not be discovered by a
merchant staring at "The request failed validation".

### 1e. Filters ✅

`ListShipmentsQuery` accepts `status` (comma-separated, so a merchant group is one value), `zone`, `q`
(tracking code or either phone, partial), and `from`/`to` as `yyyy-mm-dd` **Asia/Dhaka, inclusive**.
`parseShipmentFilters` is the single place that decides what is valid and names every bad field at
once; a bad filter is a 400 that names it, never a silent fallback to "no filter", which would show
the merchant their whole account as if the filter worked.

**A gap this found rather than filled.** `zone`, `remote_area` and `fragile` were accepted by
`POST /v1/shipments`, used to check serviceability and compute the quote, and then **discarded** —
never stored. A parcel created for `chattogram-metro` was afterwards indistinguishable from one for
`sylhet-metro`, including in the price charged, and `pricing_version` freezes the quote without
freezing its inputs, so the charge could not be explained after the fact. Migration
`1759000000037-ShipmentZone` adds the column, a partial index for the zone filter, and a GIN trigram
index for the search. `remote_area`/`fragile` are deliberately still not stored: they price the same
way and no screen reads them yet.

**Two things the boxes hid.**

1. _The zone a row was filtered by was invisible._ `ShipmentSummary` had no `zone`, so the filter bar
   narrowed the list to an attribute no column showed — the same "reads as if it covered the list"
   trap 1d hit with the search box, one level up. `zone` is now on both the list summary and the
   detail read.
2. _The status dropdown cannot be the state machine._ 24 statuses in a select box is a state machine
   diagram wearing a costume, and a merchant thinks "is it moving". Eight groups in
   [statusGroups.ts](../../apps/frontends/merchant-web/src/lib/statusGroups.ts) send the underlying
   statuses as a comma list — which is why `status` had to become multi-valued in the first place.
   The drift risk (a new status landing in no group, so the console quietly stops offering a filter for
   it) is why `verify-status-groups.mjs` reads the backend's own `SHIPMENT_STATUSES` and fails if any
   status is neither grouped nor explicitly hidden. **Proven to have teeth** by injecting a fake status
   into the state machine and watching it fail.

**What running it against the live database found that reading it would not have.** `dhakaDayStart`
returned epoch **milliseconds as a number**. `pg` renders a number as bare digits, so `1759276800000`
reached PostgreSQL as text and Postgres raised `DateTimeParseError` trying to read it as a timestamp —
**every date filter was a 500**, with the frontend showing a generic internal error. Thirty-three unit
tests on the parser passed throughout, because every one of them asserted the _value_ and none
asserted the _type_, and both representations produce the same number. Fixed by returning a `Date`,
with the assertion that would have caught it (`expect(dhakaDayStart(x)).toBeInstanceOf(Date)`) added
alongside. The exclusive `to + 1 day` bound moved into `dhakaDayEndExclusive` for the same reason:
`date + 86400000` on a `Date` is string concatenation, and that would have been a second 500 the type
checker could not see either.

Also recorded, not fixed: an unknown query param (`?sortBy=weight`) is a 400 with code `HTTP_ERROR`
and a generic detail, because `forbidNonWhitelisted` raises Nest's own `BadRequestException` which
the exception filter does not recognise as a domain error. That is the **same envelope gap** as 1d's
malformed cursor, now confirmed to be systemic rather than one endpoint's oversight.

### 1f. Detail page ✅

`GET /v1/shipments/:id` returned no addresses and no timeline. Both are needed on the detail screen
and both are cross-module reads — `GET /track/:trackingCode` is public but is a _different projection_
deliberately stripped of everything a recipient must not see. The merchant detail needed its own
merchant-scoped read contract, not the public one.

**What shipped.** The two address columns existed on `shipment.shipments` since day one and were
simply never selected. The timeline is a genuinely new read, and it lives in
[tracking/timeline-read.service.ts](../../apps/backend/src/modules/tracking/timeline-read.service.ts)
— **in the tracking module, not the shipment module**. Rule 2 says a module owns its schema, so the
detail screen cannot JOIN the log or SELECT it; it asks, through an injected service, the way every
other cross-module read here happens. `get-shipment.service.spec.ts` asserts the shipment query does
not mention `tracking.`, so the boundary is enforced by a test rather than by a convention.
Authorisation is deliberately absent from that service: the caller already proved ownership in its
own schema, and re-checking would mean reading `shipment.shipments` from the tracking module — the
same rule violation in the other direction.

On the client the metadata is genuinely open — the writers are spread across six modules — so
[timeline.ts](../../apps/frontends/merchant-web/src/lib/timeline.ts) reads it defensively and drops
everything it does not recognise. `jobId` and `pickupId` are in the same bag and stay unread: a
merchant has no job id, and a screen that renders the whole bag is a screen nobody reads.

**Two bugs the running found that reading it would not have.**

1. _A rider who takes too much cash was invisible._ `shortfallMinor` is `expected - collected`, so a
   **negative** value means the rider over-collected. The presenter showed the gap only when it was
   positive — hiding precisely the case a merchant most needs to see, and the one the cod rules call
   out by name: _"over-collection is as wrong as under-collection, and both must surface."_ It now
   reads `৳50.00 over-collected`, which is the live row in the seeded database.
2. _A correction with no target row looked like an ordinary event._ The badge keyed off
   `correctsEventId !== null`, but `reconcile-cod.service.ts` writes `EVENT_CORRECTED` with a **null**
   `corrects_event_id` — the review note is the point, and there is no single row it supersedes. Both
   signals now count, because "this row is a correction" is one concept, not two.

**A gap worth recording rather than fixing here.** Every `COD_COLLECTED` row in the seeded database is
an **orphan** — no matching `shipment.shipments` row — so none can be read through the detail
endpoint at all. That is seed data, not a code defect, and it is the reason the live proof inserts
the over-collection event onto a parcel that exists rather than reading the seeded one.

**Exit check**

- [x] A merchant creates a shipment in the browser, sees a quote before committing, and the COD
      amount in the UI equals the amount in the ledger to the poisha — 38 in-browser assertions +
      44 money-parser assertions, all green
- [x] A CSV upload previews every row with its outcome and reason, creates nothing until Accept, and
      returns a per-row result CSV that downloads as CSV — 63 client assertions + 43 live API
      assertions + 48 in-browser assertions, all green
- [x] Page 1 → page 2 → back → page 1 with a shipment created in between shows no duplicate and no
      skip — 24 client assertions + 19 live API assertions + 12 in-browser assertions, all green
- [x] Hold, release, cancel and exception each work from the UI and each are rejected on replay
      — 47 in-browser assertions, all green. **On "with the same key": these four endpoints
      deliberately take no `Idempotency-Key`.** `report-exception.controller.ts` says why — _"the
      transition itself is the dedupe"_ — so the replay assertion is that the second identical call
      is a `409 INVALID_TRANSITION` naming both states, not a silent second write. Asserting an
      idempotency-key replay here would be asserting a header the design deliberately omits.
- [x] A bad filter is a 400 that names the field, and every valid filter narrows the list — 54 client
      assertions + 85 live API assertions + 42 in-browser assertions, all green
- [x] Every screen has a loading, empty and error state — captured in `shots/` — 24 in-browser
      assertions across the list, the detail and the dashboard, all green. Nine shots:
      `states-{list,detail,dashboard}-{loading,error,empty,notfound}`.

**Screen-states proof: loading is proved by holding the API, not by screenshotting a race.**

This app server-renders, so the naive approaches do not work. Delaying the Vite route handler does
nothing — `curl` proved the server HTML already holds the final rows, and there was nothing left for
the browser to fetch. Blocking hydration to freeze the shell does nothing either, for the same
reason. Both were dead ends I spent real time on.

What actually works is that the client **does** fetch: `curl` on `/app/shipments` returns 17,981 bytes
of skeleton with **zero** occurrences of `ZP-`, and Playwright's request log then shows
`/v1/shipments?limit=25` twice — once for the SSR pass, once for `useAsync` on hydration. So the API
delay is the right lever, and it must delay **every** request, not just the first: my one-shot flag
held request one, request two flew through, and the rows rendered anyway. That is the whole reason
the three loading states failed on the first run while the error states passed.

**One real defect found and fixed:** the list's error state had no Retry. `ErrorState` takes an
optional `retry` and the detail and dashboard both pass one, but `DataTable` dropped it on the floor
— `<ErrorState message={error} />` — so a failed list load was a dead end with no way out but a
browser reload. `DataTable` now takes `onRetry` and passes it through; the list passes `page.reload`.

**1f proof: 52 client assertions + 36 live API assertions + 28 in-browser assertions, all green.**

The live proof reads a parcel the **real** write path already produced — a pickup→hub→delivery
journey, then a COD over-collection that ops reconciled — rather than hand-inserting rows, so it
proves the read against what the system actually writes. It asserts the merchant response carries no
actor, no metadata and no addresses, and that `tracking.public_timeline` has **no `actor_type`, no
`metadata` and no `corrects_event_id` column at all**: those fields are absent rather than filtered,
so there is no filter here that could be got wrong.

---

## Stage 2 — Settlement and money

**This is gap 1**, the one competitor weakness their own users complain about in public. CarryBee's
reviews call their payment screens confusing; RedX publishes a rate card and pays next banking day;
Steadfast's calculator ends in an explicit "you receive" line.

### 2a. One number, one meaning

> **"You are owed ৳X, arriving Y."**

Not outstanding / collected / pending / received as four separate figures. One derived balance, from
the append-only ledger, with the next settlement date beside it. RedX's invoice model is the parity
reference — delivery charge, COD charge, return charge, cash collected, discount, total adjustment,
amount paid out — but the merchant-facing headline is a single number.

### 2b. Screens

- COD records with per-shipment expected vs collected, and **partial collection as a first-class state**
  (the backend already models `PARTIAL_COLLECTION`)
- The reconciliation exception queue. A mismatch **blocks settlement** until reviewed, and the
  reviewer note is recorded — this is the strongest correctness story we have and no competitor
  surfaces it
- Settlement lifecycle: create → approve → initiate → confirm → settled, each a validated transition
- The itemised statement as a downloadable artifact (RedX ships CSV **and** mushok; CarryBee ships CSV
  **and** PDF)

### 2c. A public rate card

`pricing_versions` and the frozen quote engine already exist. Publish them: a calculator on the
marketing site and a printable rate card page. RedX and Steadfast both have one; CarryBee's pricing
is deliberately opaque and its T&C lets fees change unilaterally.

**Exit check**

- [x] The headline balance is derived from the ledger and reconciles to the poisha — 18 pure exit-check
      assertions + 59 live API assertions + 38 in-browser assertions, all green
- [x] A deliberately corrupted COD collection surfaces as a blocking exception with a reviewer note,
      and the ledger keeps both original rows — same three counts, all green. **Three money bugs were
      found by running it and are fixed; see below.**
- [x] A merchant can read their own rate card without calling anyone — same three counts, all green
- [x] A statement downloads and its totals match what the screen showed — same three counts, all green.
      One function builds the statement for both the screen and the CSV, so there is nothing to drift

**Three money bugs the live proof found. None is reachable by a test written against the rules, because
in all three the rules were right and the ordering was not.**

1. **`COD_EXPECTED` blocked settlement forever.** `blocksSettlement` originally included it, reasoning
   that uncollected cash is not payable. That reads correctly and is wrong: it is the ordinary state
   of every parcel on a van, so a merchant with one parcel in transit could never be settled at all.
   The unit test **passed**, because it asserted the behaviour as written. Only running the freeze
   against a real merchant showed it could never lift.

2. **The freeze ignored the correction.** A reviewed mismatch leaves two rows — `COD_COLLECTED +125,100`
   and `ADJUSTMENT -50` — and `findUnsettledCodEntries` read `entry_type = 'COD_COLLECTED'` only. It
   froze the first and not the second and **overpaid the merchant by 50 poisha**. Now pinned to
   `IN ('COD_COLLECTED','ADJUSTMENT')` with `reference_type = 'COD_RECORD'`, because `ADJUSTMENT` is
   also the return reversal and must not walk into a fresh freeze.

3. **The freeze could outrun the correction — the worst one, because it closes the hole above only
   most of the time.** A review clears the COD block in the transaction that emits the event, but the
   correcting ledger row is written later by the finance consumer. A freeze landing in that window took
   the over-collected row and not its correction. The timestamps from the proof: review committed at
   `14:33:14.283`, the freeze ran at `.324`, the correction landed at `.644` — a **320ms window**, and a
   merchant working a queue of five would hit it every time. Fixed by refusing the freeze while any
   reviewed-and-disagreeing record is still missing its `ADJUSTMENT`, which needs both sides of a
   question neither module can see alone: cod knows the review, finance knows the ledger. 7 tests in
   `correction-window.spec.ts`, and the frozen net is asserted at `185050` rather than `185100`.

**A tenant hole closed on the way past:** `POST /v1/settlements` took `merchantId` in its request body
and never checked it, so any valid key could freeze **another merchant's** collections, and it
hardcoded `actorId: null`. The merchant id now comes from the credential and the actor from the
principal. `GET /v1/merchants/:id/balance` was deleted rather than guarded — it took an unowned id,
had zero callers, and was superseded by `GET /v1/finance/balance`, which takes no id at all.

**A pricing hole closed while publishing the rate card:** `merchantPlan` was a **request body field** on
`POST /v1/pricing/quote` and `POST /v1/shipments`, so any caller could name `"growth"` and be quoted the
1000 bps discount. The plan is now a column on `merchant.merchants` read through `MERCHANT_PLAN_LOOKUP`.
The backfill is `standard` = 0 bps, so nobody's price changed.

**Proof: 59 live API assertions + 38 in-browser assertions + 18 pure exit-check assertions, all green.**
The browser proof drives the real API in the order a merchant experiences it, because the two screens
are mutually exclusive by design: review the mismatch → the freeze is allowed → freeze → corrupt the
_other_ parcel → the queue has a row again and the money screen is blocked once more. A single-shot
fixture could only ever demonstrate one of them.

**Shots:** `shots/2026-10-09_web_{money-blocked,cod-queue,settlements,settlement-statement,rate-card}.png`.

---

## Stage 3 — Hub console

New. It exists because we chose to own the network, and it is a real competitive row: none of the
three competitors ships a hub console to merchants at all.

Scan-first, and designed for the physical constraints the domain docs already name: gloves, glare,
dropped connections, bursts. **A bypassed scan is a parcel with no custody record**, so the scan is the
only primary action and everything else is secondary.

`POST /v1/hubs/scans` already exists with `INBOUND → SORT → OUTBOUND → DEPARTED → ARRIVED`. Unknown
kind is a 400; wrong order is a 409. That is the state machine — the console is a rendering of it.

Also here, because a hub is where it happens:

- Manifest seal / dispatch / receive / reconcile, raising `MANIFEST_INCOMPLETE`
- Exceptions surfaced as a work queue, not a log line

**Exit check**

- [x] An out-of-order scan is rejected at the UI with the reason shown, not only in the log
- [x] A full inbound → sort → outbound → depart → arrive cycle completes on a seeded manifest
- [x] A manifest missing a shipment raises a visible exception at reconciliation
- [x] Usable on a 5" phone screen with gloves on — verified by screenshot, honestly

### What running the exit checks changed

The API proof passed first (49 live assertions) and every row above was still unticked, because an
API can refuse a scan but cannot say whether an operator standing at a belt with gloves on can
_see_ the refusal. So `apps/frontends/hub-console` exists and `scripts/verify-console.mjs` drives all
four checks in a real browser at 375×812 — 58 assertions, plus 22 pure ones in `verify-scans.mjs`.

| Row                | How it is actually proven                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refusal shown      | Provoked as a **stale screen**, not a picker. The hub screen only ever offers the server's own next gesture, so an out-of-order scan is unreachable _by design_; what happens in a depot is a tablet that was in a pocket for four minutes. The parcel is walked to its destination on another tablet, the stale button is clicked, and the real 409 renders — asserted to name both `AT_DESTINATION_HUB` and `SORTING`, in a sentence. |
| Full cycle         | Four belt gestures clicked in the UI, each button re-read after the list refetched, ending at `AT_DESTINATION_HUB`. The fifth gesture is **not** on that screen — see below.                                                                                                                                                                                                                                                            |
| Manifest exception | Four-parcel manifest, three edges clicked in the UI, `1 of 4 parcels have not arrived` rendered as a queue with the parcel named, reconcile refused on screen, and **the same retry passing** once the parcel shows up. An exception that never clears is a dead queue.                                                                                                                                                                 |
| 5" with gloves     | Every scan target ≥ 48×88 CSS px, no horizontal overflow at 375px, tracking code ≥ 16px, and the scan is the largest target on the page. Shots in `shots/2026-10-09_hub_*.png`.                                                                                                                                                                                                                                                         |

**Three things the exit checks found that the API proof could not.**

1. **`ARRIVED` was unreachable from the UI.** `DEPARTED` deletes the presence row — the parcel has
   left that building — so the fifth gesture belongs to no hub's work list. The manifest screen now
   records arrivals against the cargo list it holds, which is the only place that still knows the
   parcel was expected. This is the plan's own words ("Exceptions surfaced as a work queue") turned
   out to describe a screen nobody had built.
2. **A manifest badged `Missing` while offering `Record arrival`** — two claims about the same row,
   one of which the data cannot support. A manifest knows what was on the truck and what has been
   checked in; it cannot know a parcel was lost in a depot. The screen now says **"have not arrived"**,
   and before `RECEIVED` it says **"Expected"**, because nobody has looked yet and 277 seeded
   manifests would otherwise all be red. The server still says `missing` in its 422 detail; that is
   the trade word and it names the reconciliation condition precisely, so it was left alone.
3. **`statusLabel` had only one vocabulary.** The manifest statuses fell through to a lowercase
   fallback, so a badge read `received` in lowercase under a button reading `Reconcile`. Found by
   reading a screenshot, not by reading the code. `verify-scans.mjs` now fails if any manifest status
   reaches the fallback.

**One assertion that was quietly wrong, twice.** The first draft of the proof reused a single parcel
as both the stale row and the missing parcel, and asserted a `missingCount` that the fixture itself
had changed. It read as a product bug and was not one. Four parcels with four jobs now, so each
assertion means what it says.

### The scope decision this stage made

`hub:read` and `hub:scan` are **not** merchant powers, and `MERCHANT_SCOPES` is now derived by
subtraction from `API_SCOPES` rather than listed. A merchant does not stand at a conveyor belt, and
`hub:scan` advances a shipment through custody — platform state, not tenant state. The direction
matters: the old shape listed merchant scopes explicitly, so the next scope anyone added was a
merchant scope until somebody remembered to subtract it. A platform scope added tomorrow is withheld
from every merchant role the moment it lands in `PLATFORM_SCOPES`. A `MERCHANT_OWNER` on the same
merchant is refused at the scan with `PERMISSION_DENIED`, proven live.

---

## Stage 4 — Rider app, offline-first

The most expensive item in the plan and the only Phase 5 gate blocker.

**This section said the server contract was "done and proven". It was not.** Reading the code rather
than the plan found: `OfflineSyncService.enqueue()` was fully implemented and had **no caller outside
tests** — there was no HTTP route to put a command on the queue, so the whole protocol was
unreachable in production while its unit and integration tests passed. `CommandQueueFullError` was
missing from `DOMAIN_ERROR_SPECS`, so a full queue would have answered **500**. There was no
`device_id` despite ADR-0012 requiring a revocable one, and no `rider:*` scope at all, so any
merchant API key could pull and acknowledge a named rider's queue.

The **device half did not exist either**. Both halves are now built.

```
Online → local command → local queue
                            ↓ network unavailable
                         Offline
                            ↓ network restored
                          Sync → server acknowledgement
```

Screens, per `docs/product/surfaces.md`: authentication · today's jobs · pickup jobs · delivery jobs ·
route · shipment detail · scan · delivery attempt · COD collection · **proof of delivery** ·
exceptions · profile.

Proof of delivery is not optional: the backend already requires OTP + photo + timestamp + GPS + rider
identity for `DELIVERED`, and three competitors have no customer-facing POD at all.

**Exit check** — this is ROADMAP Phase 5's gate, verbatim and unticked:

- [x] A rider completes a full day of jobs in airplane mode, reconnects, and the server rejects every
      duplicate while applying each command exactly once
- [x] A cancelled-while-offline shipment's scan is **explicitly rejected**, not silently dropped
- [x] Storage is capped and the cap is alerted before it is hit
- [x] `pnpm verify` green

### What landed

`POST /v1/riders/:riderId/sync/replay` — the wire ADR-0012 described and this API never had. One
transaction for the whole batch, ordered by the **device's** `createdAt` with `deviceSequence`
breaking ties, deduped on `(rider_id, device_sequence)`, one outbox event per command (rule 7).

On the device, `apps/mobile-rider/src/offline/command-queue.ts` — framework-free, so the logic that
can silently lose a rider's day is provable without a simulator. `nextSequence` is persisted and
monotonic; the cap warns at 90% and refuses at 100%; a rejection is kept with its reason rather than
retried forever.

| Check                  | Proof                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full day, exactly once | 40 commands sent shuffled, applied in device order; re-sent whole → 40 `duplicate`s and **still 40 rows**; re-sent half → 20 duplicates, still 40 rows. One `RiderCommandDelivered` per command.                                                                                                                       |
| Explicit rejection     | Parcel cancelled while the phone was in a pocket: `rejected`, reason `expected status OUT_FOR_DELIVERY, shipment is CANCELLED`, recorded on the row, **not applied**, and the retry returns the same reason rather than a generic "already seen". An unknown parcel is rejected too — it cannot be confirmed to apply. |
| Cap                    | 90 commands → `capWarning: true` **before** the limit. 101 → **409 `COMMAND_QUEUE_FULL`, not 500**, and _zero_ of the batch applied. A short batch works afterwards, so the refusal cost nothing.                                                                                                                      |

37 server-side assertions live; 30 on the device half.

### Two decisions the exit checks forced

1. **A batch that overflows is refused entirely, not partly applied.** Filling the queue with the
   first 90 and 409ing on the 91st would silently lose the rest — precisely the loss ADR-0012 exists
   to prevent. The device keeps all 101 and retries later.
2. **`capWarning` on the replay path reports the _batch's_ nearness to the limit, not the queue
   behind it.** A replayed command is applied in the same transaction and never sits pending, so a
   `queueSize`-derived warning would have been dead code that never fired.

### Not built

**The Expo app shell.** There is no React Native screen here — no login, no job list, no route, no
proof-of-delivery UI. What exists is the offline queue and its proof. That is a deliberate split: the
queue is the part that can lose a rider's day and no screenshot would catch it, and building a UI
around an unproven queue would have proved less. A screen asserting "synced" over a queue with no
exact-once guarantee is a lie with a spinner.

---

## Stage 5 — Ops console and live map

`GET /v1/control-tower/live-counts` already ships six sections including `outstandingAmountMinor`
serialised as a decimal string at the controller edge. The map and the actions are the two unticked
boxes.

### 5a. Actions

Inspect · assign pickup · assign/reassign rider · transfer · hold · release · initiate return ·
inspect attempt · inspect COD. Each one is an existing state transition with a validated `from × to`
pair. The ops console is where the state machines become operable.

### 5b. Live map — the one row we win

PostGIS 3.6 is already in the stack and `service_areas` exists. Map hubs, riders and parcels in
flight.

**This is the single item where we would beat all three competitors rather than match them.** Zero map
libraries appear in the CarryBee or RedX bundles; Steadfast has an OpenLayers bundle but no map on its
tracking path. It is also the most demo-legible thing in the entire plan — a moving parcel across
Dhaka is the portfolio demonstration.

Position updates are event-sourced like everything else, and the public tracker must never receive
them.

**Exit check**

- [x] Assigning a rider from the map produces one assignment event and one tracking event
- [x] Two concurrent assignments of the same job produce exactly one winner
- [x] A rider's position is visible to ops and **absent** from the public tracking response
- [x] The map degrades to a list when the tile server is unreachable

### What landed

`POST /v1/riders/:riderId/position` (guarded on `rider:sync`) and `GET /v1/control-tower/map`
(guarded on `hub:read`). Both platform scopes — a merchant is our client, not our network partner,
and does not get to watch the network's riders. Proven live at 403 for a client key.

`apps/frontends/control-tower` — the map is an SVG the app draws itself from an equirectangular
projection over a fixed Bangladesh bounding box, with raster tiles as an optional background layer
behind it. That ordering is the whole design: **markers are ours, tiles are decoration**, so the map
is never _dependent_ on a third party, only _less useful_ without one.

| Check                     | Proof                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One assignment, one event | Exactly one `PickupAssigned` outbox row and one `PICKUP_ASSIGNED` tracking event per assignment.                                                                                                                                                                                                                                                |
| Two dispatchers, one job  | Two requests with **different** idempotency keys fired together → `201` + `409 Cannot move from ASSIGNED to ASSIGNED.` Still one outbox row, one tracking event. A third attempt with a fresh key is refused by the state machine, and still one event — three attempts, one truth.                                                             |
| Position private          | Ops sees the coordinate, the staleness in seconds, and the hub load. The public response contains no latitude key, no rider name, and no field of any spelling. And `tracking.public_timeline` has **no coordinate column to leak from** — checked against `information_schema`, so this is structural rather than a filter someone can forget. |
| Tile fallback             | Every tile connection refused → the console swaps to the list by itself, no operator action, stating why and how many failed. One dead tile does **not** flip it — a blip is not an outage.                                                                                                                                                     |

40 backend assertions live, 16 in the browser, 25 pure checks over the projection and the tile policy.

### Three things the exit checks found

1. **A clamp was a lie.** The first draft nudged an out-of-bounds coordinate to the nearest frame edge —
   which draws a confident dot on the border of Bangladesh and reads as "this hub is at the edge of the
   network". Replaced with `isInBounds`: an unplaceable marker is **dropped and counted**, because a
   counted omission is honest and a clamped one is not.
2. **The map and its fallback disagreed.** The list showed 20 hubs while the map drew 18, with nothing
   explaining the difference. A fallback that silently differs from the thing it replaces is a screen
   an operator cannot trust about either number; both now report the same dropped-marker count.
3. **The tile layer was one image repeated.** The first draft drew _N_ copies of the same tile URL.
   Replaced with real slippy-tile indices computed from the bounding box — pure, and testable, which is
   why it now lives beside the projection rather than inside the component.

### One correction to the plan's own premise

The plan said position updates are "event-sourced like everything else". They are half: `last_known_*`
is **overwritten**, which is the one deliberate exception to rule 8 in the codebase. A rider's 400th
GPS ping has no operational meaning once the 401st arrives. What _is_ appended is `RiderPositionUpdated`
in the same transaction, so the network's history can still answer "when did this rider cross the river?"
without the present-tense table growing forever. The exception is recorded in the service rather than
left for a reader to infer.

---

## Stage 6 — Public tracking and developer portal

Gaps 2 and 4.

### 6a. Tracking

Already good and **privacy-safe by construction** — `tracking.public_timeline` is a purpose-built
projection that cannot carry money, because it is not the internal event feed with fields removed.
Keep that property while adding to it.

Competitive deltas, in order of value:

1. **Opaque per-parcel token.** Steadfast's best idea: a 20–64 char unguessable token instead of a
   tracking-code lookup. Ours is currently a code on a public endpoint at 100 req/min per IP. The
   code format is `ZP-[0-9A-HJKMNP-TV-Z]{10}` — short enough to be an enumeration vector on a public
   route. This is a small change to an endpoint we already own
2. **Estimated delivery window**, computed from the SLA rules that already exist
   (`rules/sla.ts`, Asia/Dhaka cutoffs, holiday calendar)
3. **Rider identity on the assigned step only** — CarryBee already does this one line
4. **Proof of delivery image** after delivery. Three competitors: none
5. Keep the rating widget idea — all three collect public feedback

### 6b. Developer portal

**Nobody in this market has one.** CarryBee: "contact your KAM". RedX: docs and a sandbox exist but no
OpenAPI spec. Steadfast: nothing, and its own SDK's default URL no longer resolves.

We already generate an OpenAPI spec and an api-client from controller decorators. The portal is
publishing what exists:

- The generated spec, browsable, with **try-it** against a seeded sandbox
- API key minting, rotation and revocation — `POST /v1/api-keys` already works
- Webhook registration plus a **visible delivery log**: every attempt, status code, and next retry on
  the ladder. CarryBee has a `tryout` button; RedX and Steadfast have no delivery log at all
- The webhook contract stated properly: HMAC over the raw body, the retry schedule, the event
  catalogue, and what happens on a duplicate delivery

Excluded by decision: sandbox credentials on request, store plugins, SDKs in other languages.

**Exit check**

- [ ] A merchant registers a webhook, sees each delivery attempt in a log, and replays a failed one
- [ ] A signature is verified from the raw body by a script a stranger could write from the docs alone
- [ ] A published OpenAPI request round-trips against the seeded sandbox from a fresh client
- [ ] The tracking token is unguessable at 20+ characters and rate limiting still applies

---

## Stage 7 — Parity sweep

Walk [_index.md](_index.md) §1 row by row. Anything left at ○○ or ●○○ gets either a build or a
**written reason** in that file. A scorecard that flatters us is worse than no scorecard.

Known remaining after the stages above:

| Row                                         | State after Stage 7      | Note                                                                                                 |
| ------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Notification preferences                    | build                    | The backend sends; there is no screen to configure it. SMS and email exist, push does not            |
| Analytics depth                             | build                    | Projections and a rebuild CLI ship; charts and money labelling do not                                |
| Bulk formats                                | build                    | XLSX in remains deferred by `ROADMAP.md`. Decide it here, with a trigger                             |
| Merchant apps                               | **skip, written reason** | Web-first. The three competitors' apps are Cordova, 3.6★ and new — this is not where the effort goes |
| Desktop                                     | **skip, written reason** | Electron over the ops console. Phase 6 rung 8's own reasoning                                        |
| Risk scoring                                | build                    | The data exists; the score does not                                                                  |
| Live map, POD image, ETA on public tracking | build                    | Stage 5 and Stage 6                                                                                  |

---

## What is deliberately not built

| Skipped                                     | Why                                                                     | Trigger to revisit                                  |
| ------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| Shopify / WooCommerce / marketplace plugins | Excluded by decision                                                    | Never, for this project                             |
| Helpdesk, ticket module, live chat          | Excluded by decision                                                    | Never, for this project                             |
| Rider and hub-manager self-onboarding       | Demo-seeded network                                                     | A real hub operator asks to onboard                 |
| A second payment gateway                    | One integration is enough to learn from                                 | A merchant asks                                     |
| Optimal routing / VRP                       | Deterministic and explainable beats marginally better and unexplainable | Measured utilisation becomes the binding constraint |
| Merchant SDKs in other languages            | The generated TS client covers our own surfaces                         | A third party asks                                  |
| Kubernetes, read replicas, Elasticsearch    | One VPS and `pg_trgm` are sufficient                                    | Measured pressure                                   |
| A second market                             | Bangladesh end-to-end first                                             | Bangladesh is stable                                |

---

## Risks

| Risk                                                                                                        | Mitigation                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stage 0 is invisible and gets skipped.** Ten identity items and six security items produce no screenshot. | Stage 0 has its own exit check and it blocks Stage 1's tenant-scoped screens. Do not start Stage 1 on the old identity.                           |
| Stage 4 takes twice as long as estimated.                                                                   | The server contract is already proven. The device half is the whole cost, and it is one Expo app, not a system.                                   |
| The live map becomes a sink.                                                                                | PostGIS is already there. Cap it at hubs + riders + parcels in flight. No heatmaps, no routing, no tiles beyond the basemap.                      |
| Production completeness means every surface is thin until very late.                                        | Each stage ends in a runnable, screenshotted screen. That is the mitigation, and it is why the order is by surface.                               |
| `ROADMAP.md` Phase 1 and 2 boxes are stale, so gates lie.                                                   | Audited as part of Stage 0. Until then, trust the integration tests over the checkboxes.                                                          |
| Scope total exceeds what one person sustains.                                                               | The stages are ordered so any prefix is a coherent product. Stopping after Stage 2 leaves a real, demoable, honest system — not a half-built one. |

---

## Related

- [_index.md](_index.md) — the scorecard and ranked gaps this plan closes
- [carrybee.md](carrybee.md) · [redx.md](redx.md) · [steadfast.md](steadfast.md)
- [../surfaces.md](../surfaces.md) — the ten surfaces this plan sequences
- [../../ROADMAP.md](../../ROADMAP.md) — build order and phase gates
- [../../../state.md](../../../state.md) — current position and traps
