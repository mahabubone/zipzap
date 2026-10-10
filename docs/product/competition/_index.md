# Competitive landscape — CarryBee · RedX · Steadfast

One page. Research date **2026-10-08**. Deep dives: [carrybee.md](carrybee.md) ·
[redx.md](redx.md) · [steadfast.md](steadfast.md).
**What we are doing about it: [plan.md](plan.md).**

## Method and honesty note

Every merchant dashboard in this comparison is login-walled. None was rendered. Findings come from
live page fetches, **unauthenticated client bundles** each provider serves, and unauthenticated API
probes. That is high confidence on _what exists_ and no confidence at all on visual polish.

Everything below is marked ✅ verified, ◐ inferred, ❌ unverifiable. **Competitor claims are their
marketing, not our assessment.** Where their own sources contradict each other, both are shown rather
than averaged.

**Also note what this is not.** All three are courier networks with riders, hubs and vans. ZipZap is
a logistics _operating system_ that models the whole chain. We are not trying to out-deliver 3,500
agents; we are trying to out-_software_ 300,000 registered merchants whose panels are the weakest part
of their own product.

---

## 1. Scorecard

Legend: ●●● strong ●●○ present ●○○ thin ○○○ absent · **Z** = ZipZap today

| Capability                        |     CarryBee     |           RedX            |     Steadfast     |                  ZipZap                  |
| --------------------------------- | :--------------: | :-----------------------: | :---------------: | :--------------------------------------: |
| Merchant web panel                |       ●●●        |            ●●●            |        ●●○        |              ●●○ 12 routes               |
| Public tracking (no login)        |       ●●●        |            ●●○            |        ●●●        |                   ●●○                    |
| Map / ETA on public tracking      |       ○○○        |            ○○○            |        ○○○        |                   ○○○                    |
| Proof of delivery to end customer |       ○○○        |            ○○○            |        ○○○        |       ●●○ OTP+photo+GPS, required        |
| Bulk import                       |     ●●○ CSV      |         ●●○ XLSX          |   ●●○ 500/file    | ●●● CSV, preview checkpoint, 10k in ~96s |
| Create-shipment in the UI         |       ●●●        |            ●●●            |        ●●○        |              ●●○ form ships              |
| Exception work queues             |       ●●●        |            ●●○            |        ●●○        |         ●○○ COD queue, read-only         |
| Fraud / risk scoring              |       ●●○        |            ●○○            |        ●●●        |                   ○○○                    |
| Return reattempt tooling          |       ●●●        |            ●●●            |        ●●○        |             ●○○ backend only             |
| COD reconciliation                |       ●○○        |            ●●○            |        ●○○        |       ●●● records + reviewer note        |
| Settlement ledger                 |       ●●○        |            ●●●            |        ●●●        |             ●●● append-only              |
| Self-serve payout request         |       ●●○        |            ●○○            |        ●●●        |             ●●● backend only             |
| Staff roles & permissions         |  ○○○ unverified  |            ●●●            | ●○○ account-level |                   ○○○                    |
| Notification preferences          |       ●●○        |       ●●○ SMS+email       |        ○○○        |                   ○○○                    |
| Push notifications                |       ●●●        | ○○○ capability, unexposed |        ○○○        |                   ○○○                    |
| OpenAPI spec                      |       ○○○        |  ○○○ docs exist, no spec  |     ○○○ none      |              ●●● generated               |
| Sandbox                           |       ○○○        |         ●●● live          |        ○○○        |              ●○○ fakes only              |
| Webhook signatures + retry ladder |       ○○○        |            ○○○            |        ○○○        |            ●●● HMAC + 1m→24h             |
| Idempotency on writes             |       ○○○        |            ○○○            |        ○○○        |            ●●● nine endpoints            |
| Published rate limits             |       ○○○        |            ○○○            |   ●●● 1000/call   |               ●●● per tier               |
| Merchant-configurable pricing     |       ○○○        |     ●●○ per shop/area     |  ○○○ negotiated   |           ●●● pricing versions           |
| Public live rate calculator       |       ●●○        |            ●●●            |        ●●●        |                   ○○○                    |
| Mobile apps quality               | ●●○ Cordova, new |      ●●○ 3.6★ / 500K      |   ●●● 4.2★ / 1M   |                 ○○○ none                 |
| Rider app                         |       ●●○        |      ○○○ none found       |   ○○○ internal    |         ●●○ Expo, offline-first          |
| Multi-business / multi-shop       |       ●●●        |            ●●●            |        ●○○        |                   ○○○                    |

**Read the ZipZap column honestly.** The right half of that table is a specification, not a product.
Everything ●●● under "backend only" is code with no screen attached.

**The Stage 7 sweep moved five rows, and not all of them up.** Three were _understated_ — a
scorecard that flatters us is bad, but one that undersells us is simply wrong, and an operator
reading this file to decide what to build next would have built the wrong things. Create-shipment,
the exception queue and the merchant panel all had screens the table said did not exist. Two moved
up because Stage 4 finished the rider app and Stage 6 finished proof of delivery. One claim in the
plan was flatly false: analytics was described as counters only, and `analytics.cod_summary` has
carried `expected_minor` since migration 0029. Per-row evidence:
[plan.md](plan.md#stage-7--parity-sweep).

---

## 2. Where the market is genuinely good

Three things every credible competitor does well, and where matching them is table stakes:

- **Free, no-login, no-CAPTCHA public tracking.** All three ship it. None of them put a map, an ETA,
  a rider identity, or a proof-of-delivery photo on it.
- **A bulk import that returns per-row results.** CarryBee CSV, RedX XLSX, Steadfast "500 orders in one
  file, every row comes back with an ID and a tracking link". Ours is the strongest of the four — we
  added a human preview checkpoint and have live-proven 10,000 rows in ~96 seconds.
- **A COD line item on the invoice**, separated from the delivery charge. RedX is best at this
  (delivery charge, COD charge, prepayment charge, paid-return charge, return charge, cash collection,
  discount, credits used, total adjustment, amount paid out).

## 3. Where they are weak — ranked by how hard they would be to fix

| #   | Gap                                              | Who                 | Why it is stuck                                                                                                                                                                            |
| --- | ------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Settlement is opaque or confusing**            | CarryBee            | Their users say so in public reviews. No COD fee published; two contradictory payout cycles; a 50% return fee buried in clause 3.32 and contradicted by the app-store copy.                |
| 2   | **No developer platform**                        | all three           | CarryBee: no docs site, "contact your KAM". RedX: docs exist, sandbox exists, **no OpenAPI spec**. Steadfast: nothing at all, and its own SDK's base URL is dead.                          |
| 3   | **Webhooks are unsound**                         | all three           | CarryBee: hand-written HTML pages, no signature. RedX: no signature, no retry, no delivery log. Steadfast: bearer token, no signature, no retry, no log. **We already do this correctly.** |
| 4   | **Public tracking is a text timeline**           | all three           | Zero map libraries in the CarryBee or RedX bundles. No ETA, no POD image, no signature anywhere.                                                                                           |
| 5   | **Risk is handled by phone calls, not software** | RedX, Steadfast     | RedX robocalls. Steadfast scores a buyer — but only in a dashboard widget, not as a hold decision.                                                                                         |
| 6   | **Content and analytics debt**                   | Steadfast, RedX     | Steadfast: FAQ stale by ৳5/parcel, dead `/pricing.html`, Universal Analytics, duplicate `x-frame-options`. RedX: static export, no server-rendered content.                                |
| 7   | **Pricing is not self-serve**                    | CarryBee, Steadfast | Both negotiate offline. Steadfast's own calculator says _"merchants on negotiated rates are billed on theirs"_.                                                                            |
| 8   | **Self-service is not really self-service**      | all three           | Onboarding is a KAM or a Google Form. Support is a hotline. Agent onboarding at CarryBee is a Google Form.                                                                                 |

## 4. What each one is actually best at

- **CarryBee** — exception work queues with approve/reject (No Entry, Return, Last-Mile, Urgent
  Approval), OCR label intake, an AI create path, and realtime merchant↔agent chat.
- **RedX** — Smart Return Pro (reason-coded reattempt with a mandatory agent-performance audit),
  next-banking-day payout with Saturday processing for bKash/City Bank, and the only real developer
  sandbox plus both a Shopify app and a WooCommerce plugin.
- **Steadfast** — the fraud-check-before-you-ship loop, passkeys and MFA, a command palette, bilingual
  UI with Bangla numerals, and the best public tracker in the market.

## 5. The gap that matters most — it is ours to lose

**ZipZap's merchant console is read-only.** Six routes. No create-shipment form. No mutation buttons
anywhere. Cursor pagination exists in the API and is not wired to the table.

Behind that UI sits an API that already supports create, cancel, exception, hold, release, bulk
import, pickup request, pickup assign, returns with approval, COD collect and reconcile, settlement
create→approve→initiate→confirm, webhooks, and API-key minting.

> **Roughly 90% of the backend's business capability has no screen.** That is the single largest gap in
> this comparison — and it is the only one none of the three competitors can be said to have.

A merchant evaluating us today sees a KPI grid and a read-only table. Everything that makes the
architecture defensible is invisible.

## 6. Recommended order of attack

Sequenced by value-per-unit-of-work. Nothing here requires an architectural change.

| #   | Move                                                          | Why now                                                                                                                             | Cost       |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | **Create-shipment form + bulk import UI**                     | The API is done and proven. Everything else is a dashboard for a feature that cannot be exercised.                                  | small      |
| 2   | **Shipment actions: cancel / hold / release / exception**     | Four buttons, four existing endpoints. Converts a read-only console into an operational one.                                        | very small |
| 3   | **Settlement screens + "you are owed ৳X, arriving Y"**        | Attacks gap #1 above, which is a competitor's self-admitted weakness.                                                               | small      |
| 4   | **Wire cursor pagination into `DataTable`**                   | Already client-side only, with a `ponytail:` note saying so. 100 rows today.                                                        | small      |
| 5   | **Live rate calculator on the marketing site**                | RedX and Steadfast both have one. Ours has `pricing_versions` and a frozen, versioned quote engine — we are one screen from parity. | small      |
| 6   | **Exception work queues**                                     | CarryBee's strongest feature. We have the state machines and the transitions; we need the screens.                                  | medium     |
| 7   | **Developer portal: publish the OpenAPI we already generate** | We generate an api-client from controller decorators. Every competitor requires a phone call for this.                              | medium     |
| 8   | **Opaque per-parcel tracking token**                          | Steadfast's best idea. A small change to an endpoint we already own.                                                                | small      |
| 9   | **Buyer-risk score**                                          | We hold the event history, COD and returns data. Steadfast computes this by hand in a widget.                                       | large      |

### Do not build

- **A map.** Nobody in this market has one on a customer-facing surface; it is a feature-shaped
  distraction for a system that does not own vehicles.
- **A rider app yet.** Two of three competitors appear to have none, and the third's is Cordova. Our
  sync contract is done and that is the correct order — the device half is a separate bet.
- **Anything to match their scale claims.** 300,000 registered merchants against ~5.7M cumulative
  parcels is a long tail with a 1.6★ Shopify app. We want the underserved mid-market, not the head.

## 7. What to write down when it changes

This document is a snapshot of 2026-10-08 and a market that moves fast. Re-verify before quoting a
single number in a deck. Update the ZipZap column the moment a row stops being accurate — a
scorecard that flatters us is worse than no scorecard.

Related: [plan.md](plan.md) · [carrybee.md](carrybee.md) · [redx.md](redx.md) ·
[steadfast.md](steadfast.md) · [../surfaces.md](../surfaces.md) · [../roadmap.md](../roadmap.md) ·
[../../../state.md](../../../state.md)
