# CarryBee — competitive teardown

Research date **2026-10-08**. Method: live HTTP fetches of public pages, unauthenticated reads of the
Next.js client bundles, and live probes of the public pricing/tracking APIs.

## How to read this

| Marker | Meaning                                                    |
| ------ | ---------------------------------------------------------- |
| ✅     | Verified from a fetched page, bundle, or live API response |
| ◐      | Inferred from adjacent evidence; not directly confirmed    |
| ❌     | Could not verify — behind a login, or does not exist       |

**The merchant panel is login-walled and was never rendered.** Everything below about merchant-panel
screens comes from two authoritative route maps embedded in the panel's public client bundles
(`APP_ROUTES`, `API_ROUTES`), plus live HTTP probes (307→login = route exists, 404 = does not).
That is high-confidence evidence of _what exists_, not of how it looks.

---

## 1. Who they are

|                 |                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| Legal entity    | CarryBee Express Ltd., Dhaka                                                                                          |
| Claimed scale   | 35,000+ merchants · 20M+ cumulative deliveries · 64 districts                                                         |
| Corporate claim | "Operates under the US-Bangla group" — stated only in the FAQ and app listings, **never on the website**. Unverified. |
| Hotline         | 09613 555 111                                                                                                         |
| Merchant app    | iOS `id6751934236` · Android `com.carrybee.merchant`, **10K+ Play installs, ~5 months old**                           |
| Agent app       | iOS `id6751965286` · Android `com.carrybee.agent`, 6K+ installs                                                       |

> **Read the scale claim carefully.** 35,000 merchants against a merchant app with 10K installs means
> the overwhelming majority of CarryBee adoption is **web-panel**. The panel is the product; the app
> is not.

---

## 2. Product surfaces

| Surface                        | URL                                 | State                              |
| ------------------------------ | ----------------------------------- | ---------------------------------- |
| Marketing site                 | `carrybee.com`                      | ✅ Next.js SSR                     |
| Public tracking                | `/track?consignmentId=…`            | ✅ no login, no CAPTCHA            |
| Rate calculator                | `/calculator`                       | ✅ hits a live pricing API         |
| FAQ                            | `/faq`                              | ✅ 110+ Q&As                       |
| Merchant panel ("Super Panel") | `merchant.carrybee.com`             | ❌ login-walled                    |
| Merchant self-registration     | `/register`                         | ✅ name + BD phone + business name |
| Password reset                 | `/forgot-password`                  | ✅ OTP flow                        |
| **Developer API docs**         | in-panel `/webhook/documentation/*` | ❌ no public docs site             |
| SDKs / sandbox                 | —                                   | ❌ **do not exist**                |

**Verified absences** (all 404): `docs.carrybee.com`, `developer.carrybee.com`, `api.carrybee.com`,
`/blog`, `/help`, `/features`, `/services`, `/pricing`, `/dashboard`, `/api-docs`. No OpenAPI, no
Swagger, no Postman collection, no sandbox, no published rate limits. `sitemap.xml` and `robots.txt`
both return the Next.js 404 page.

**Dead route constants**: their own `APP_ROUTES` declares `public.pricing="/pricing"`,
`public.help="/help"`, `public.orderTrack="/order-track"` — **all three 404**. `/pricing` in the
footer actually points at `/calculator`. Their documentation constants are stale against what they
shipped.

---

## 3. Merchant panel — screens

Complete list, all live-probed. Note how much of it is **multi-business** scaffolding: every order,
store, invoice and analytics screen is nested under `/businesses/:id`.

**Business / multi-tenant shell**
`/businesses` · `/create` · `/choose` · `/:id` · `/:id/profile` · `/:id/dashboard?startDate&endDate` ·
`/:id/settings` · `/:id/update-password` · `/:id/faq`

**Orders** `/orders` · `/create` · `/create/bulk` · `/:orderId` · `/:orderId/edit` · `/datewise`
**Returns** `/:orderId/reverse-pickup` · `/reverse-pickup` · `/reverse-pickup/bulk`
**AI intake** `/orders/ai-create`
**Customers** `/customers` · `/create` · `/:id` · `/:id/edit` · **`/customers/fraud-checker`**
**Store operators** `/operators` · `/create` · `/:id` · `/:id/edit`
**Stores** `/stores` · `/create` · `/:id` · `/:id/edit`
**Invoices** `/invoices` · `/create` · `/:id` · `/:id/edit`
**Analytics** `/analytics` + `/sales` `/customers` `/orders` `/revenue`
**Payments** `/payments` · `/payments/create`
**Exception queues** `/high-alert/last-mile-issue` · `/no-entry` · `/partial-delivery` ·
`/return-list` · `/urgent-approval`
**Pickup** `/request-pickup` · `/pickup-requests`
**Notifications** `/notifications` · `/notifications/settings`
**Agent messaging** `/businesses/:id/agent-messages`
**Developer** `/webhook/quick-setup` · `/credentials` · `/integration` · `/events` · `/reference` ·
`/documentation` + 10 endpoint doc pages

**Dashboard widgets** — five dedicated endpoints: `today-work-progress`, `active-orders`, `heads-up`,
`order-stats`, `payment-stats`, plus a **pending-actions counter aggregating four work queues**
(no-entry, return, last-mile-issues, urgent-approval).

---

## 4. Merchant panel — feature detail

### 4.1 Order intake — five mechanisms

| Mechanism            | Evidence                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Single create        | `POST /businesses/:id/orders`                                                                           |
| Bulk CSV             | `POST /orders/bulk`; FAQ: _"Create Order > Bulk Order. Download the Sample CSV… upload via Import CSV"_ |
| Bulk reverse pickup  | `POST /orders/bulk-reverse-pickup`                                                                      |
| **OCR label intake** | `POST /ocr/extract-customer-info` — extract customer info from an uploaded shipping-label image         |
| **AI create**        | dedicated `/orders/ai-create` screen                                                                    |

Plus address parsing: `POST /address-parser/batch`, `GET /area-suggestion`, `GET /location-tree`, and
a location hierarchy of **cities → zones → areas**.

❌ **No Shopify app, no WooCommerce plugin, no Daraz/Pathao-store integration.** The FAQ says _"Yes,
CarryBee's API can be integrated with… WooCommerce and Shopify"_ — that is **manual API work by the
merchant's own engineers**, not a plugin.

### 4.2 Order lifecycle actions

`detail` · `update` · `short-update` · `track` · `cancel` · **`send-note`** (note to agent) ·
**`execution-request/hold`** · **`execution-request/urgent`** · `report-issue` · `return-reprocess` ·
`reprocess` · `exchange` · **`send-to-another-customer`** · `reopenPickupCancelled` ·
`print` → proof-of-delivery print.

Merchant-app changelog corroborates: _"Send to another customer · Execution request · Fraud Report ·
Send Notes · Update Existing Info in Order Details."_

### 4.3 Exception handling — their strongest feature set

Four dedicated queues, each with an **approve/reject** workflow:

- **No Entry** — `pending-actions/no-entry` → reprocess
- **Return reprocess** — `pending-actions/return` → reprocess
- **Last-mile issues**
- **Urgent approvals** — `urgent-approvals/:id/approve`, incl. pickup-return

Plus a **structured issue taxonomy** (`ir/categories`, `ir/sub-categories`, `POST /api/v2/ir/issues`)
and a **two-way fraud report lifecycle**: merchant accuses a customer of a fake order and can
**withdraw** the accusation. `customers.fraud-checker` scores a customer record.

An app-store review literally complains about **"Access to No Entry Parcel"** and **"Automated Return
Reprocessing"** — these are headline features to their users, not footnotes.

### 4.4 COD and settlement

COD is a **per-order field**, surfaced publicly on tracking as `collectable_amount`. There are **no
dedicated COD screens**; settlement runs through invoices and payments.

- **Invoices** — list, `stats`, export, detail, export-single, **per-invoice `order-csv`** and
  **`pdf`**
- **Payments** — `create`, `payment-info`, `payment-frequency`
- **On-demand withdrawal** — `payable-consignments`, `payable-amount`, **`withdraw-request`**,
  `payable-due`, `merchant-payment/initialize`, `merchant-payment/verify`
- **Rails** — `GET /wallets`, `/wallets/:id/branches`; bKash, Nagad, bank transfer; T&C §3.27
  specifies **BEFTN**

> **The clearest attack surface in the whole market.** The only substantive Play review of the
> merchant app (May 2026, 4.8★) reads: _"The complicated thing is the Payment, Outstanding payment,
> collected payment, payment received, pending payments etc all of this make complications… The
> recent on-demand payment service is great but not yet mature."_ Their users cannot tell what they
> are owed.

### 4.5 Notifications

| Channel                   | Evidence                                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web push                  | OneSignal SDK in bundle; `/push/notifications`, `/push/mark-as-read`, `/push/mark-all-as-read`, **`/push/dnd-status`**                                                            |
| Realtime                  | **Centrifugo** WebSocket; `/auth/centrifugo-token`                                                                                                                                |
| In-app                    | `notifications/unseen-count`                                                                                                                                                      |
| SMS                       | merchant **and** end customer at pickup / out-for-delivery / delivered                                                                                                            |
| Email                     | Statement of Payment per disbursement (T&C §3.28)                                                                                                                                 |
| **Merchant ↔ agent chat** | `messaging/send-chat`, `init-chat`, `chat-list`, `consignment-thread-list`, `unread-messages` — agent changelog: _"Agents and merchants can now message each other in real time"_ |

A `/notifications/settings` screen exists; which channels are toggleable is ◐ unverified.

### 4.6 Staff and permissions

`operators` CRUD exists (create, detail, edit, delete). The FAQ hedges: _"Multi-user access under a
single merchant account **may** be supported. Contact your KAM."_ The app changelog confirms operator
users are real.

❌ **Granular RBAC is unverified.** `/settings/roles` and `/settings/permissions` return 307 — but so
does `/settings/zzzqqq123`, so `/settings` is a catch-all segment and 307 is not a signal. Treat
role-based access control as **not demonstrated**.

### 4.7 Pricing model

**Server-authoritative. Merchants cannot configure rate cards.**

`business.utilities.priceCalculation` → `GET /businesses/:id/price-calculation`; parameters are origin
and destination city, weight in grams, delivery type, item type. T&C §5.2: _"Courier reserves the
right to unilaterally amend service fees at any time."_ Only per-account **discounts** are negotiable
(§5.3).

Live rate card pulled from the public calculator API:

| Weight | Dhaka→Dhaka | Dhaka→Chattogram / Sylhet |
| ------ | ----------- | ------------------------- |
| 200 g  | ৳49         | —                         |
| 500 g  | ৳60         | —                         |
| 1 kg   | ৳70         | ৳135                      |
| 2 kg   | ৳90         | —                         |
| 5 kg   | ৳150        | —                         |

The response also carries `discount` and `total_fee`. Weight is **continuous in grams**, not discrete
slabs. Granularity is **64 districts**; zones exist in the API but are not the pricing axis.

---

## 5. Public tracking UX — the thing a recipient actually sees

Page: `carrybee.com/track`. I read the component source, so this is exact.

**Asks for exactly one field.** `aria-label="Tracking ID input"`, placeholder _"Enter your consignment
ID here"_. Enter submits; button reads `Track Now` (text hidden on mobile, chevron shown).

**No phone number. No CAPTCHA of any kind** — grepped for recaptcha/turnstile/hcaptcha, zero hits.
**No login.**

Live response for an unknown ID:
`{"message":"rpc error: code = NotFound desc = record not found","error":true}`, HTTP 404. Empty param
→ `"consignmentId is empty"`. Envelope is nested `data.data.data`.

**What is displayed** (response destructures `{order, business, states, review, agent}`):

1. **Three stat cards** — Est. Delivery · Current Status (on a highlighted yellow card) · Destination
2. **Consignment ID** in a green pill prefixed `#`, and **`Price: ৳{collectable_amount}`** — the COD
   amount is public to anyone holding the ID
3. **Sender details** — business name, phone **masked** `017********`
4. **Receiver details** — name, address, phone masked `01********`
5. **"Shipment Journey"** — vertical timeline, each step colour-themed green/yellow/red from
   `current_status_id`; current step is a filled card, past steps pale, future steps grey dots. **Every
   step carries a plain-English explanation.** Special case: on `assigned_for_delivery` it renders
   literally _"Agent ({name}: {phone}) has picked up your parcel for delivering."_
6. **Rating widget** — "Rate Your Experience", 1–5 stars (Poor → Excellent), optional 500-char comment,
   **required 11-digit phone number**, POST `/orders/:id/feedback-public`, gated on `review.can_rate`
7. **Support card** — hotline 09613555111

**Full status vocabulary** (14 slugs, verbatim) — a genuinely rich state machine:

```
created · picked · sorted · in_transit · received_at_lmh · assigned_for_delivery
· delivered · pickup_cancelled · partial_delivery · return · paid_return
· exchange · damaged · lost
```

**What is absent:** **no map** (grepped for mapbox/google maps/leaflet — zero hits; the `h-96` skeleton
is the timeline card). No ETA confidence or range. No courier photo. No signature capture. No POD
image. No delivery-attempt count. No OTP entry — and T&C §3.21 confirms **verification codes are issued
only for non-COD parcels**, so COD customers confirm by cash alone.

**Mobile vs desktop:** identical DOM, one responsive layout (`sm:grid-cols-3` → `grid-cols-1`,
`max-w-1280px`). Middleware detects the viewport server-side but serves one page. **Fully usable on
mobile with no app and no login.**

---

## 6. Technology

| Layer           | Finding                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| Framework       | Next.js **App Router**, Turbopack, React 19-era client                                                                |
| Rendering       | SSR + heavy client components, `no-store` everywhere; merchant panel is a client app behind middleware auth (Auth.js) |
| Styling         | **Tailwind v4** (CSS-first `@theme`, `@property`, `color:lab()`), **shadcn/ui on Radix**, lucide-react, Inter         |
| Brand tokens    | `--primary: #ffcc00`, `--custom-secondary: #a20025` — a yellow-and-crimson identity                                   |
| Data            | TanStack Query v5, next-themes (light/dark)                                                                           |
| Backend         | **Kong 3.9.0** behind Cloudflare; errors leak `"rpc error: code = NotFound…"` → the BFF calls **gRPC microservices**  |
| Realtime        | Centrifugo (WebSocket) + OneSignal (push)                                                                             |
| API docs        | hand-written in-panel HTML pages only                                                                                 |
| Edge            | Cloudflare CDN + WAF; HSTS 15,552,000 s; static assets on CloudFront                                                  |
| **Mobile apps** | **Cordova** (`io.cordova.myapp…`, 30 MB), not React Native                                                            |

**Third-party courier integrations confirmed**: a WordPress plugin and Sohoj Dokan both connect to
CarryBee as one of several couriers. CarryBee is an **API-only supplier inside other people's order
forms** — a real structural disadvantage against owning the merchant relationship.

---

## 7. Commercial terms

⚠️ **The sources contradict each other.** Flagged rather than smoothed over.

| Topic          | Position                                                                                         | Source         |
| -------------- | ------------------------------------------------------------------------------------------------ | -------------- |
| Service level  | _"Same-day inside Dhaka, 72 h outside"_                                                          | app stores     |
| Service level  | Dhaka→Dhaka **24–48 h**; Dhaka→outside **3–4 days**; outside→Dhaka **48–72 h**                   | FAQ            |
| Pickup windows | Dhaka **4–10 PM** (last entry 5 PM); outside until 5 PM; delivery 10 AM–8 PM; support 9 AM–10 PM | FAQ            |
| COD fee %      | **never published** — "quoted at signup"                                                         | —              |
| Settlement     | five days a week / every working day, BEFTN or MFS                                               | T&C §2, §3.27  |
| Settlement     | _"every 6 working days after creating an invoice"_                                               | app stores     |
| Return fee     | **50% of the original delivery charge**                                                          | T&C §3.32      |
| Return fee     | _"No return charge inside Dhaka"_                                                                | app store copy |

**Two fee-realization models.** **SFRM 1** (default) — courier deducts fees from COD and remits the
balance. **SFRM 2** (enterprise only) — courier remits COD **in full** and invoices delivery fees
monthly, against a separate SLA.

**Claims**: 15-day window; **video of unboxing mandatory or the claim is void**; liability capped at
the **lower of parcel value or ৳10,000**.

**Prohibited items** include **mobile phones/tablets/PCs**, **cash**, and firearms. Not carrying
electronics or cash is a hard ceiling on the addressable market — and a usable angle for a platform
that does not have a network.

---

## 8. Verdict

### Where CarryBee is genuinely strong

- Exception-work queues (No Entry / Return / Last-Mile / Urgent Approval) with approve/reject — real
  operational tooling, not cosmetic
- Two-way fraud reports + a fraud checker bound to a customer record
- OCR label intake and an AI create path
- Realtime merchant ↔ agent chat inside the panel
- Free public tracking: no login, no CAPTCHA, 14 states, plain-English per step
- On-demand COD withdrawal and per-invoice CSV **and PDF** export

### Where they are weak

1. **Settlement UX is self-admitted confusion.** "outstanding / collected / payment received / pending"
   is their users' words, and on-demand payout is called "not yet mature" in their own changelog.
   **This is the single clearest opening in the market.**
2. **Financial terms are deliberately opaque** — no COD fee %, two contradictory payout cycles, a 50%
   return fee buried in clause 3.32 and contradicted by the app-store copy.
3. **No developer platform.** No public docs, no OpenAPI, no SDKs, no sandbox, no published rate
   limits. _"Contact your KAM for credentials."_
4. **No merchant-configurable pricing.** Fees can change unilaterally at any time by clause.
5. **No marketplace integrations.** No Shopify app, no WooCommerce plugin. Merchants write the
   integration themselves.
6. **Thin public tracking** — no map, no ETA range, no POD image, no signature, and **the COD amount is
   published to anyone with the ID**.
7. **Pricing granularity is 64 districts**, not zones, despite zones existing in the API.
8. **Content-governance debt** — `/pricing`, `/help`, `/order-track` declared but 404; no `robots.txt`
   or `sitemap.xml`; conflicting SLA claims across three sources.
9. **Cordova mobile apps**, both under six months old.
10. **No self-serve support or agent onboarding** — a KAM plus a hotline is the entire escalation path.

### What ZipZap should take from this

Publish the rate card and the COD fee with an in-product calculator. Ship **one** money view: _you are
owed ৳X, arriving Y_. Build a real developer portal (OpenAPI + sandbox + generated client — already
the house style, see [ADR-0004](../../ADR/0004-swagger-generated-openapi.md)). Put the exception queues
in as first-class screens, because that is the part of their product merchants actually live in. And
keep the public tracker free of money — ZipZap's `tracking.public_timeline` projection already cannot
leak it, which RedX and Steadfast both fail at.

---

Related: [redx.md](redx.md) · [steadfast.md](steadfast.md) · [_index.md](_index.md) ·
[../surfaces.md](../surfaces.md) · [../roadmap.md](../roadmap.md)
