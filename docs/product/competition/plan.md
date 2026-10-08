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

| Work                                                                                                                   | Source                       |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Schema `identity`: users, identities, sessions, credentials, devices, roles, permissions, role_permissions             | ROADMAP Phase 1, 10 unticked |
| Argon2id; constant-time compare on every secret and signature                                                          | ROADMAP security, unticked   |
| Two principal kinds — a machine API key must never open a browser session                                              | ROADMAP Phase 1              |
| Session rotation on privilege change; audit events for login, failed login, logout, rotation, revocation               | ROADMAP Phase 1              |
| Guards enforce **permissions**, never role names                                                                       | ROADMAP Phase 1              |
| Tenant scoping derived from the principal                                                                              | ROADMAP Phase 1              |
| Seven role bundles: platform admin, ops manager, hub operator, support agent, merchant owner, merchant operator, rider | ROADMAP Phase 1              |
| Multi-business: orders, stores, invoices and analytics nest under a business id                                        | CarryBee parity              |
| Rate limiting fails **closed on writes**, open on reads                                                                | ROADMAP security             |
| `REQUEST_ID` propagated edge → log → span                                                                              | ROADMAP security             |
| Customer-data reads audited, not merely restricted                                                                     | ROADMAP security             |

**Exit check**

- [ ] An API key cannot obtain a browser session, and a session cannot call an API-only scope
- [ ] Two operators on one merchant hold different permissions; the denied one gets 403 **without**
      leaking the resource's existence
- [ ] One login can act inside two businesses and cannot read the third — proven by test, per module
- [ ] Argon2id is the only password hash in the database; a timing test on signature compare is in CI
- [ ] A write under rate limit returns 429, and the limit cannot be bypassed by retrying

---

## Stage 1 — Merchant web

The 90% gap, and the highest payoff in the plan. Everything here is a screen over an endpoint that
already works.

### 1a. Create a shipment

`POST /v1/shipments` exists and takes a mandatory `Idempotency-Key`. The form needs: sender name,
phone, address · recipient name, phone, address · weight in grams, description · COD amount and
currency · zone, remote-area and fragile flags · merchant plan. All of it is already in
[create-shipment.controller.ts](../../apps/backend/src/modules/shipment/create-shipment.controller.ts).

- The phone fields must normalise to E.164 on the client — the server regex is
  `/^\+8801[3-9]\d{8}$/` and a Bangladeshi merchant typing `017…` will be rejected by it
- Zone and serviceability checked before submit: `GET /v1/coverage?zone=` already answers
- **A quote preview before commit.** `POST /v1/pricing/quote` is version-frozen; showing the
  merchant what they are about to be charged is the RedX/Steadfast calculator parity row

### 1b. Bulk import

Upload → **human preview checkpoint** → accept → chunked → result CSV. The 10,000-row path is
already live-proven at ~96 s. Only the UI is missing. The preview checkpoint is the differentiator and
must not be simplified away — the first upload always has a column-mapping mistake.

### 1c. Actions on a shipment

Four buttons, four existing endpoints: `POST /v1/shipments/:id/{cancel,exception,hold,release}`. The
`Dialog` component and a "Hold shipment?" story already exist. Each action needs an `Idempotency-Key`
and a typed confirmation where it is irreversible.

### 1d. Cursor pagination, properly

`GET /v1/shipments` returns `{ data, pagination: { nextCursor, hasMore } }`. `DataTable` is
client-side only and carries a `ponytail:` note saying so. Replace it with a cursor-fed table. **The
existing `Pagination` component takes `pageIndex`/`pageCount`** — a page-number API cannot express a
cursor. One of the two has to change; the cursor is the correct end state because the API already
speaks it.

### 1e. Filters

`ListShipmentsQuery` today accepts `limit` and `cursor` only. A merchant console needs status, date
range, zone, and search by tracking code or phone. Adding query params is a backend change, so fold
it in here rather than discovering it in Stage 7.

### 1f. Detail page

`GET /v1/shipments/:id` returns no addresses and no timeline. Both are needed on the detail screen and
both are cross-module reads — `GET /track/:trackingCode` is public but is a _different projection_
deliberately stripped of everything a recipient must not see. The merchant detail needs its own
merchant-scoped read contract, not the public one.

**Exit check**

- [ ] A merchant creates a shipment in the browser, sees a quote before committing, and the COD
      amount in the UI equals the amount in the ledger to the poisha
- [ ] 10,000-row CSV upload previews, is corrected, is accepted, and returns a per-row result CSV
- [ ] Page 1 → page 2 → back → page 1 with a shipment created in between shows no duplicate and no skip
- [ ] Hold, release, cancel and exception each work from the UI and each are rejected on replay with
      the same key
- [ ] Every screen has a loading, empty and error state — captured in `shots/`

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

- [ ] The headline balance is derived from the ledger and reconciles to the poisha
- [ ] A deliberately corrupted COD collection surfaces as a blocking exception with a reviewer note,
      and the ledger keeps both original rows
- [ ] A merchant can read their own rate card without calling anyone
- [ ] A statement downloads and its totals match what the screen showed

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

- [ ] An out-of-order scan is rejected at the UI with the reason shown, not only in the log
- [ ] A full inbound → sort → outbound → depart → arrive cycle completes on a seeded manifest
- [ ] A manifest missing a shipment raises a visible exception at reconciliation
- [ ] Usable on a 5" phone screen with gloves on — verified by screenshot, honestly

---

## Stage 4 — Rider app, offline-first

The most expensive item in the plan and the only Phase 5 gate blocker. The server contract is done and
proven: device command queue, ordered replay by `created_at`, explicit rejection of commands
invalidated while offline, idempotent acks.

The **device half does not exist**. This stage builds it against the contract that is already there.

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

- [ ] A rider completes a full day of jobs in airplane mode, reconnects, and the server rejects every
      duplicate while applying each command exactly once
- [ ] A cancelled-while-offline shipment's scan is **explicitly rejected**, not silently dropped
- [ ] Storage is capped and the cap is alerted before it is hit
- [ ] `pnpm verify` green

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

- [ ] Assigning a rider from the map produces one assignment event and one tracking event
- [ ] Two concurrent assignments of the same job produce exactly one winner
- [ ] A rider's position is visible to ops and **absent** from the public tracking response
- [ ] The map degrades to a list when the tile server is unreachable

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
