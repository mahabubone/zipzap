# Rider app revmap — closing the UI gap to the market

Research baseline: 2026-10-11. Companion to [plan.md](plan.md) Stage 4, which built the rider app's
_contract_ and its offline core. This document is about the _screen_.

## 1. The research finding, stated honestly

**The three competitors this file usually benchmarks against have no public rider apps.**

| Competitor | Rider app                          | Evidence                                                                                                                                                                                                              |
| ---------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steadfast  | ❌ none                            | Six plausible package IDs probed (`com.steadfast.rider`, `.agent`, `.delivery`, `.courier`, `.riderapp`, `.steadfastrider`) — all 404. Riders appear to use an in-house build tool. ([steadfast.md](steadfast.md):61) |
| RedX       | ❌ none verified                   | `/redx-truck-driver-app-policy` is a legal document for the FTL/LTL truck network, not a rider app. ([redx.md](redx.md):81)                                                                                           |
| CarryBee   | ❌ none found                      | —                                                                                                                                                                                                                     |
| **Pathao** | ✅ **Pathao Drive / Pathao Agent** | The real market leader's rider app. `com.pathao.driver`, `com.pathao.agent` — GPS-tracked, Pathao Pay wallet, daily leaderboard, hot zones. Genuinely shipped and used, and the only one of the four a Bangladeshi rider has actually held. |


[_index.md](_index.md):53 already scores us **●●○ on the rider app against ○○○ across the board** — the
one row in the entire scorecard where we are structurally ahead. Two of three competitors have no app
to compare with, and the third's is Cordova.

**So the honest baseline is: Pathao plus global delivery-partner apps**, not the three this folder
usually names. That is also the useful comparison, because Pathao is the app a Bangladeshi rider has
actually held.

## 2. What the real benchmarks do, and what is worth copying

From Pathao Drive's own feature list and from the delivery-partner app patterns used in the market
(Zamboree-style partner apps, courier UI kits):

| Pattern                                     | Who does it                                                                                                                                                                                                              | Worth copying?                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Today you earned ৳X, N deliveries"**     | Pathao: _"Track your earnings and stats"_, _"Daily leaderboard with the chance to win bonus"_; partner apps track daily earnings and cash collected                                                                      | **Yes — the single biggest gap.** This is the number a rider works for.                                                                                     |
| **Cash-in-hand with a carry limit**         | Partner apps: _"a cash deposit flow that enforces a carry limit before allowing the rider to accept new orders"_                                                                                                         | **Yes — and it is our domain.** A rider carrying too much COD is a real operational risk, and our queue already models the cash.                            |
| **Go-online / shift / availability**        | Pathao: _"No fixed working hours. You are your own boss"_, partner apps: _"going online within booked shift slots"_, _"zone-based availability system that blocks riders from going online outside their assigned area"_ | **Yes — a shift primitive.** Cheap, and it is what makes an offline app coherent: a rider is either on shift or not.                                        |
| **One obvious primary action, big targets** | Partner apps: _"designed specifically for low-tech-familiarity users, with large touch targets, clear language, and minimal cognitive load at every step"_                                                               | **Yes.** Our job detail screen presents three equal-weight forms.                                                                                           |
| **State cues at every step**                | Pathao Drive Ride Flow facelift: _"states of each step and added visual clues for Riders to understand the interface at a glance"_                                                                                       | **Partly.** Our status badges do this; the job detail does not.                                                                                             |
| **Call the customer**                       | Steadfast: _"the rider will call first"_; every partner app has it                                                                                                                                                       | **Yes — trivially cheap, very high value.** A rider at a wrong door must be able to call.                                                                   |
| **Incoming order + countdown timer**        | Partner apps: _"real-time incoming order screen with a countdown timer"_                                                                                                                                                 | **No — wrong model.** Ours assigns jobs; an offer-accept flow with a countdown is a different product.                                                      |
| **Map / turn-by-turn navigation**           | Pathao Agent: _"Maps & Navigation"_; partner apps: Google Maps integration                                                                                                                                               | **No — needs native.** The native bundle does not build here (see [apps/mobile-rider/README.md](../../../apps/mobile-rider/README.md)). Defer, and say so.  |
| **Wallet and cash-out to bKash/Rocket**     | Pathao Pay                                                                                                                                                                                                               | **No — product scope.** That is a payments product. The rider's own balance, computed from what they actually collected, is in; transferring it out is not. |

## 3. Gap analysis — our app against those patterns

| #   | Pattern              | Our app today                                                                                                                   | Verdict    |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Earnings headline    | `ProfileScreen` shows `rider-7`, a scope count, and a queue summary. No money anywhere.                                         | ❌ absent  |
| 2   | Cash in hand         | `SyncScreen` shows queue depth. Cash is typed into a form and queued, never surfaced back.                                      | ❌ absent  |
| 3   | Shift / availability | None. Only network connectivity is modelled.                                                                                    | ❌ absent  |
| 4   | One primary action   | `JobDetailScreen` renders three cards — pickup scan, failed attempt, complete-with-COD — at equal weight, all requiring typing. | ❌ weak    |
| 5   | Customer contact     | None. A rider with no customer phone has no reason to call.                                                                     | ❌ absent  |
| 6   | State cues           | `JobsScreen` has coloured rails and status dots; `JobDetailScreen` has a hero.                                                  | 🟡 partial |
| 7   | Offline honesty      | `SyncScreen` + queue badge + offline chip. Better than any competitor.                                                          | ✅ lead    |
| 8   | Proof of delivery    | `ProofScreen` mints a code and queues photo + coords.                                                                           | ✅ lead    |

## 4. The revmap

Ordered by (value × feasibility). Each item names the pattern it closes and how it is proved.

### P0 — No backend, no native. Build now.

#### R1. "Your day" replaces the bare jobs list

**Closes:** earnings + shift + state cues.

A header block above the jobs feed that answers, in one glance:

- **On shift / Off shift** (a local toggle, persisted — not a server call; see R2)
- **N jobs** assigned today, **N done**
- **৳X in hand** — derived from the device's own queue (see R3), so it is truthful rather than a
  server number this app does not have
- **৳Y earned** — deliberately labelled as "_on this device_" until R6 exists, so it is never a lie

`toJobRows` already returns everything needed for the counts; the queue already exposes
`pending()`/`settled()`. No new endpoint, no new noun.

**Proof:** `shots/mobile/2026-10-12_rider_home_*.png` — on-shift with jobs, off-shift, empty day,
offline with a queue. Four states, driven by the shots script's fixture, not by a hand-typed screen.

#### R2. A shift primitive

**Closes:** go-online / availability.

A shift is a small persisted object `{ startedAt, endedAt, riderId }` in AsyncStorage. On shift is the
default on sign-in (a rider who opened the app intends to work), and toggling it off is explicit —
pausing, not logging out. The jobs feed is _the work for this shift_: jobs assigned before
`startedAt` are not shown, because a rider opening the app mid-week must not be handed Tuesday's
parcels.

That last sentence is the actual requirement, and it is not decoration: without it, "today's jobs" is
"every job ever assigned to me", and the app is a liability on a shared device.

**Proof:** a job created before `startedAt` is absent from the feed; starting a shift surfaces it.
Two assertions in the existing shots script, plus a unit test on the pure predicate in
`src/rules/shift.ts`.

#### R3. Cash in hand, derived from the device's own queue

**Closes:** the carry limit.

`cod.collected` commands already flow through `OfflineQueue` with a `collectedMinor`. Sum what this
device has queued-and-not-yet-rolled-up, subtract what the server's rulings say was settled, and show
it as **"৳X in hand"** with a soft warning above a threshold and a hard one at the cap.
Not a wallet: no balance endpoint is being invented, and no money is being moved. It is an
accounting of what the rider is physically carrying, which is exactly what a carry limit is for.

The threshold is a UI decision (R2's threshold, not a policy engine). The cap already exists and is
already alerted — `capWarning: true` at 90% before the refusal — so the hard limit is not new
machinery.

**Proof:** queue a ৳23,750 collection and assert "৳237.50 in hand" with the quote beside it; drive it
past the threshold and assert the warning names the threshold; settle it and assert the number drops.

#### R4. One primary action per job

**Closes:** minimal cognitive load, large touch targets.

`JobDetailScreen` today is a form: type a Shipment ID, pick one of nine failure reasons in a wrap,
type the cash. Restructure as a **decision screen**:

- The parcel, its state, and **the single next legal action** — the server already refuses illegal
  edges with `409 INVALID_TRANSITION` naming both states, so the UI must never offer one. This is the
  same property the hub console was built to ("_the console never offers an action the machine will
  refuse_") and the rider app does not yet have it.
- The rest of the actions reachable but visually secondary.
- The failure-reason picker: nine chips is a state machine wearing a costume. Show the likely ones,
  hide the rest behind "More reasons", and make the likely ones big.
- Cash: a keypad, not a text field. This is a phone with a numeric keyboard and a rider with one hand.

**Proof:** every offered action is legal in the current state, and every illegal one is absent — the
assertion pattern from `verify-scans.mjs`, replayed for delivery. Plus: every primary target ≥ 48dp,
verified in the shots script as the hub console already verifies its own.

#### R5. Call the customer

**Closes:** Steadfast's most-cited UX failure and the cheapest win on the list.

The delivery job has no customer contact today (see R6 for why), so this is deliberately
**scaffolded, not faked**: the UI now has the action and states "Call number not available" rather
than rendering a `tel:` link to nothing. A dead button that looks real is worse than an honest gap.

**Proof:** the action is present on every delivery job and never offered for a pickup (there is nobody
to call at a shop scan); with no contact on the job it says so instead of dialling.

### P1 — Needs a backend endpoint. Build immediately after P0.

#### R6. Delivery job detail with COD amount and a customer contact

`RiderJobsDto` carries no COD amount and no customer name/phone — a rider is asked to collect cash
without being told how much, which cannot be fixed in the UI. One additive field set on
`rider.deliveries` (or a small rider-scoped read), then R4 and R5 become real.

This is the only genuinely blocking dependency in this document, and it is the first thing to build if
a backend change is allowed.

#### R7. "Today you earned" — server-truthful

A rider-scoped earnings projection: parcels delivered × rate, cash collected, from the append-only
ledger that already exists. Pathao's own framing ("the delivery fee update instantly in the app") is
the parity row. Derived server-side, never counted on the client, and labelled with the timestamp it
is true as of.

Once this exists, R1's device-scoped number earns its right to be the headline.

### P2 — Blocked on the native bundle. Do not start.

#### R8. Map and navigation

Needs `expo-maps` (or similar) and a working native build. The blocker is `react-native-screens`
(reproduction: `apps/backend`'s sibling README). Track, do not start.

#### R9. Barcode scanning on pickup

`expo-camera` — same native blocker. Worth it, and far cheaper once the native bundle builds than a
hand-typed Shipment ID is to a rider.

#### R10. Push notifications

Expo push tokens plus a `rider` device table. ADR-0012 already names the missing
`rider.devices` revocation table; that is the right first step, and it is backend work.

---

## 5. What this revmap deliberately does not do

| Skipped                                 | Why                                                                                                | Trigger to revisit                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------- |
| Incoming-order + countdown flow         | Our model assigns jobs; an offer-accept flow is a different product                                | A merchant asks for rider bidding |
| Wallet / cash-out to bKash or Rocket    | That is a payments product, not a rider screen                                                     | A payout partner signs            |
| Map and navigation                      | Blocked on the native bundle                                                                       | `react-native-screens` builds     |
| Dark mode                               | A voucher: the token set is ready, and it is a token change                                        | A rider reports glare at dusk     |
| Design tokens shared with `packages/ui` | `packages/ui` is a web Tailwind library; sharing means extracting colour tokens to a third package | A second RN surface exists        |

## 6. How each revision is proved

The rider app has one honest advantage over every competitor: it is screenshotted, in a browser, from
the real bundle. `apps/mobile-rider/scripts/shots.mjs` already drives all eleven states through
`expo export --platform web` with the API stubbed at the network boundary. Every revision above adds
its shots to that run rather than a new harness.

Two properties already proved on this app and carried forward:

1. **A shot of an error is worse than a stale shot.** The web console's control-tower shot was
   captured with a credential that lacked `network:read` and rendered a well-designed
   `PERMISSION_DENIED` box that passed for content. The shots script now fails rather than capture a
   screen that is not the product.
2. **Assert state, never sleep.** The notifications toggle's first shot captured React's pre-render
   because the script slept. It now polls `aria-checked` and fails if the other switches move.

## 7. Risks

| Risk                                                                                              | Mitigation                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0 builds a "device-scoped earnings" number that R7 will later replace, so the number moves twice | Label it as device-scoped from the first commit. R1's copy is the honest one, not a marketing one.                                                           |
| R2's shift changes what "today's jobs" means, so existing job lists get smaller                   | That is the point. The assert is a pre-shift job being absent, which is the property we want.                                                                |
| R4 restructures the screen riders already use                                                     | Keep every existing action reachable in one tap; only the visual weight changes.                                                                             |
| "No map" reads as unimpressive next to Pathao                                                     | The map row is already scored in our favour in [_index.md](_index.md):53; the offline row is the lead. Do not trade the lead for parity on a native blocker. |

## 8. Related

- [plan.md](plan.md) Stage 4 — the offline contract and the queue this revmap builds on
- [_index.md](_index.md) §1 — the scorecard, where the rider app is the one row we lead
- [steadyfast.md](steadfast.md) · [redx.md](redx.md) · [carrybee.md](carrybee.md) — and the honest
  note that none of the three is the benchmark here
