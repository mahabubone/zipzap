# RedX — competitive teardown

Research date **2026-10-08**. Method: live HTTP fetches, client-bundle reads (35 shared chunks plus 12
merchant page chunks), and unauthenticated live API probes.

## How to read this

| Marker | Meaning                                                |
| ------ | ------------------------------------------------------ |
| ✅     | Verified from a fetched page, bundle, or live response |
| ◐      | Inferred; not directly confirmed                       |
| ❌     | Could not verify — login-walled or does not exist      |

RedX's merchant panel is a client-rendered SPA whose chunks are unauthenticated but only loaded on
authenticated pages. Everything in §2 is read out of those chunks — high confidence on _what exists_,
no claim made about visual polish or which features ship enabled per plan.

**Ownership**: RedX is a **ShopUp** product. `api.redx.com.bd` serves a ShopUp page; the Play Store
publisher is _"ShopUp Mobile"_; backend hosts are `*.shopups1.xyz`.

---

## 1. Who they are

|                 |                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Claim           | "Bangladesh's Largest Logistics Network"                                                                             |
| Coverage        | 64 districts · 493 sub-districts · 490+ upazilas · **1,192 areas** · 3,500+ frontline agents · 3.5M+ sq ft warehouse |
| Payout          | **next banking day after delivery**                                                                                  |
| COD fee         | **0% inside Dhaka**, 1% outside                                                                                      |
| Merchant app    | Android `com.redx.delivery`, **500K+ downloads, 3.6★**, updated Sep 2026                                             |
| Customer rating | ❌ **no merchant count and no parcel-volume figure is published anywhere**                                           |

---

## 2. Product surfaces

### 2.1 Merchant web — no separate domain ✅

All 92 routes live on `redx.com.bd` itself. Next.js **static export** + SPA.

```
/dashboard · /ltl-dashboard · /parcel-list · /create-parcel · /parcel-import-bulk
/consignment-list · /create-consignment · /bulk-parcel-status · /return-list
/payments · /payment-details · /payment-status · /credit-history · /view-report
/shop-list · /shop-add · /shop-payment · /shop-pickup · /pickup-locations
/team-management/{add-employee, manage-team, permissions-modal, verify}
/notification-settings · /coupon · /issue-list · /issue-details · /rating/*
/customer-parcel-request/* · /courier · /merchant-chat
/consignment-payments · /offlinePayments · /c2cPayments · /advance-payment-*
/developer-api · /api-integration-request
```

Non-merchant routes are notable — RedX sells **merchant financing and truck rental on the same panel**:
`/apply-for-eloan`, `/eloan-{faq,repayment,success}`, `/loan-calculator`, `/truck-owner`,
`/courier` (C2C), `/agent-applications/*`.

### 2.2 Public ✅

| Surface             | URL                                 | Auth     |
| ------------------- | ----------------------------------- | -------- |
| **Public tracking** | `/track-global-parcel?trackingId=X` | **none** |
| FAQ (65 Q&As)       | `/faq/`                             | none     |
| Coverage            | `/coverage-area/`                   | none     |
| Enterprise          | `/enterprise/`                      | none     |
| T&C                 | `/terms-n-conditions/`              | none     |
| Blog                | `blog.redx.com.bd` (WordPress)      | none     |

❌ `/track` → **404**. `/track-parcel` is the merchant-scoped variant and redirects to
`/track-global-parcel` when logged out.

### 2.3 Integrations ✅ — the best in this comparison

| Integration             | URL                                           | State                                                     |
| ----------------------- | --------------------------------------------- | --------------------------------------------------------- |
| **Production Open API** | `openapi.redx.com.bd/v1.0.0-beta`             | live, 401 as expected                                     |
| **Sandbox**             | `sandbox.redx.com.bd/v1.0.0-beta`             | **live and separately hosted** (401, not 404 — it exists) |
| **Shopify app**         | `apps.shopify.com/redx-delivery`              | ✅ 200                                                    |
| **WooCommerce plugin**  | `wordpress.org/plugins/redx-for-woocommerce/` | ✅ 200                                                    |

❌ **Rider app: none could be verified.** `/redx-truck-driver-app-policy` and `/redx-trucks-privacy-policy`
are legal documents for the **FTL/LTL truck network**, not a consumer rider app.
❌ **Merchant iOS app: no App Store link found** in any bundle or page, despite iOS FAQ copy implying one.

---

## 3. Merchant dashboard — features

### 3.1 Create / edit parcel

39 form fields extracted, including: `customerName`, `customerPhone`, `alternateCustomerPhone`,
`customerAddress`, `selectedArea`, `weight`, `cod`, `invoiceNumber`, `deliveryType`, `parcelType`,
**`fragile`**, **`liquid`**, `instruction`, sender/seller name+phone, `businessType`,
**`merchantDeliveryCharge`**, **`paidReturnCash`**, `sellingPrice`, `parcelValueConfirmation`,
`paymentMethod`, `pickupAddress`.

- Product categories: Books, Clothing, Community, Crafts, Document, Food, Groceries, Home, Hub, Others,
  Package, Stationaries
- Toggles: **Fragile**, **Liquid** — these exist because liability for them is excluded (see §6)
- **Reverse-parcel** confirm modal; **exchange** flows (`exchange-delivery` / `exchange-return`)
- Area autocomplete on `/v4/logistics/areas/predict`, labelled **"Location generated by REDX AI"** /
  **"Location edited by you"**
- Edit gated behind a `can-edit` check
- **Customer address book** with a shareable address-collection form link

### 3.2 Bulk

`/parcel-import-bulk` — Excel-oriented template UI, upload progress, `downloadFourSticker`.
Bulk create v1 + v2, bulk status update (`PUT /v2/logistics/bulk-status-updates`), bulk-create logs with
pagination, and **re-import of existing parcels** (`import?isDelivery=true`).
◐ CSV vs XLSX not conclusively determined — the UI is Excel-styled throughout.

### 3.3 Parcel list — the densest screen

108 KB chunk. Multi-select with bulk actions: **Approve Return**, **Print Labels (single / four
sticker)**. Export parcel history is asynchronous ("Download in progress" modal). Search by tracking
ID / invoice / phone. Filters: **Settled / Unsettled**.

Row actions: parcel track · raise an issue · **view call log** · view issue log · print label ·
**POD image**. `PodImageModal` fetches a signed URL per tracking ID and offers a download.

### 3.4 Status vocabulary — the richest in the market ✅

20 public filter slugs:

```
pickup-pending · deleted · damaged · at-sorting · in-transit-to-last-mile
· at-delivery-hub · delivery-in-progress · on-hold · delivered · partial-delivered
· return-in-progress · returned · paid-returned · reverse · return-at-delivery-hub
· in-transit-to-return-hub · at-return-hub · rider-out-for-return · exchange-return
· partial-return
```

Internal-only statuses add: `picked-up`, `pickup-in-progress`, `pickup-hold`, `ready-for-delivery`,
`line-haul-in-progress`, `hub-transfer`, `agent-hold-returning`, `agent-area-change`,
`area-change-received`, `area-change-transfer`, `approved-by-merchant`, `returning`,
`hub-approval-pending`, `ready-for-delivery-by-merchant`, `shopup-returned`, `merchant-return`.
_(Their own source contains a status string with a leading space — `" hub-transfer-to-line-haul"`.)_

**Client-side status groups** (module 68667) — statuses are bucketed behaviourally:
`in-progress`, `not-yet-out`, `terminal/cancelled`, `COD-applicable`, `payment-settled`, `returning`.
Polling interval **30 s** (`d8 = 30000`).

**Official webhook enum** is a much smaller set: `ready-for-delivery`, `delivery-in-progress`,
`delivered`, `agent-hold`, `agent-returning`, `returned`, `agent-area-change`, `paid`.
⚠️ **The public webhook vocabulary does not match the dashboard vocabulary** — an integrator has no
authoritative list.

**Delivery types**: `regular`, `reverse`, `exchange-delivery`, `exchange-return`, `partial-delivery`,
`partial-return`.

### 3.5 COD

Cash collection amount plus a weight-basis component. **The COD fee is a separate line item**
(`codCharge` in the charge-calculator response). COD applicability is status-driven. **Partial-delivery
OTP** for partially delivered parcels. **Prepayment / pickup-hold**: _"pickup-hold status & require
prepayment… You have pre-payment due of ৳{0}. Please pay to proceed to your parcel pickup."_

### 3.6 Returns — where RedX is ahead of everyone

- `/return-list` shows tracking ID, invoice, customer name/phone/alternate phone/address/area, parcel
  cash, **current hub**, **number of attempts**, duration, notes
- **Call-recording playback in-app** — the robocall verification system (_"অটো-জেনারেটেড একটি স্বয়ংক্রিয় কল"_):
  the system calls the customer to verify a return or hold
- **Smart Return Pro** — merchant picks **Reattempt** or **Return**. Reattempt requires one of three
  reason codes: (1) customer convinced to receive, (2) agent didn't go to the doorstep, (3) agent
  didn't call. _"Mandatory for delivery agent performance audit."_
- **3-day approval window** else the agent re-attempts; up to **4 attempts** under reason 1, else
  auto-return
- Dedicated `/update-return-number` for a separate return contact number

### 3.7 Settlement — a fully itemised invoice model ✅

UI strings give the exact line items, which is genuinely more transparent than CarryBee:

```
Delivery Charge · COD Charge · Prepayment Charge · Paid Return Charge · Return Charge
· Cash Collection · Promocode Discount · RedX Credits Used · Total Adjustment Amount
· Amount Paid Out · Disbursed Amount · Paid Amount · Invoice ID / No. / date
```

Actions: download invoice · **download mushok** (Bangladeshi tax invoice) · Pay now · Insta Payment ·
**bKash** · pay your due · bounced payments · advance-payment repayment · credit history · offline and
C2C payments. Rails: **bank account or bKash**, switchable any time.

### 3.8 Notifications ❌ no push

Channels are **SMS/phone call and email only**. Settings screen is granular:
account login OTP · account login email · **rider call number** (the number the rider will call) ·
parcel notifications · **partial-delivery OTP** · return-parcel call & OTP. Changing phone or email
requires a 4-digit OTP.

Firebase is wired in the platform (FCM registrations exist) but **no merchant-facing push channel
was found** — capability exists, unexposed. That is an opportunity, not a gap to defend.

### 3.9 Reporting & analytics

Dashboard tooltips define ~21 metrics verbatim: `orders_placed`, `orders_delivered`,
`orders_to_be_delivered`, `orders_returned`, `orders_to_be_returned`, `successful_delivery`,
`parcels_pickup_hold`, `in_linehaul`, `in_delivery_hub`, `rider_out_for_delivery`, `pickup_pending`,
`delivery_attempted`, `available_credits`, `total_sales`, `delivery_fees_collected`,
`total_unpaid_amount`, `payment_processing`, `paid_amount`, `cash_collection_pending`,
`advance_payment`.

Reports module with date ranges and CSV-ish export, plus an **LTL summary**. **Robocall-verified
status** bulk lookup and **KAM notes** on `/v2/parcels/audit-logs`.

### 3.10 Staff and permissions ✅ — the best verified RBAC in the market

`/team-management/manage-team`: employee list (name, email, employee ID, created, role), add, delete.
Roles map server-side via `getShopEmployeeRoleIdMapping` with at least `admin`; **Admin cannot be
deleted**.

Permission model is a `{PERMISSION_ID}:{pageName}:{access}` matcher (`hasPermission`) over pages
`DASHBOARD`, `PARCEL_LIST`, `PAYMENTS`, with access levels including `ACCESS_TO_PAGE`. Nav is filtered by
permission; unauthorised pages render _"You do not have access to this page"_. A **permissions
comparison modal** shows owner vs employee access across panels.

### 3.11 Shops and pricing

Multi-shop with per-shop pickup stores, shop settings, payment method, merchant type, product category,
NID verification gating. Merchant type routes to different dashboards (`/ltl-dashboard`).

**Pricing is genuinely per-shop and per-area**: `/logistics/shop/{shopId}/pricing` and
`/logistics/shop/{shopId}/area/{areaId}/pricing`. Charges resolve on
`(delivery_area_id, pickup_area_id, weight_grams, cash_collection_amount, category_id,
category_variant_id)`. Three zones: **Inside City / City Suburb / Outside City**. **Coupons** and
**RedX Credits**. Merchants can override the delivery charge on a parcel (`merchantDeliveryCharge`).
Weight slabs exist; the table is login-only ❌.

**Public calculator** on the homepage: weight to 10 kg, selling price, pickup area, delivery area, VAT
inclusive. **Enterprise pricing is quote-based** — _"contact our agents"_.

---

## 4. Public tracking UX

`https://redx.com.bd/track-global-parcel?trackingId=X` — _"Type in your parcel ID to track its
whereabouts"_.

| Question | Answer                                                                      | Evidence                                                |
| -------- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| Fields   | **Tracking ID only.** No phone.                                             | homepage `trackingInputPlaceholder:"Enter Tracking ID"` |
| CAPTCHA  | **None.** Zero occurrences across all 35 chunks.                            | grep                                                    |
| Login    | **No**                                                                      | `G = !!token && shops.length>0`                         |
| Backend  | `GET api.redx.com.bd/parcel-track/{id}` + `/logistics/global-tracking/{id}` | live probe 200                                          |

**Displayed publicly**: parcel ID · customer name · area · placed-at (formatted `MMM, Do, YYYY hh:mm
a`) · weight in kg · **COD in ৳** — the last two only when `PARTNER_NAME === "RedX"`.
**Displayed when logged in**: adds full customer address and phone.

**Timeline**: Ant Design `Timeline`, bilingual `message_en` / `message_bn` (NotoSansBengali + Lato both
loaded).

| Absent               | Note                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| **Map**              | **None.** No Google Maps / Mapbox / Leaflet / react-map in any chunk.                                 |
| **ETA**              | None. Only event timestamps.                                                                          |
| **Rider name/phone** | Not on public tracking. `riderCallNumber` is a _merchant notification setting_, not rider disclosure. |
| **POD / signature**  | POD exists **only in the merchant parcel list**. Nothing for the end customer.                        |

**Displayed**: delivery attempt count (_"The total delivery attempts for this parcel is"_).
**Actions**: Raise an Issue (requires **phone verification** — pick customer _or_ merchant identity,
then verify); view issue log; **Reattempt / Return** — both dead-end with _"In order to approve return or
reattempt merchant have to login to the panel"_; **view call recordings** (merchant and customer call
logs). Login-walled variants render _"To view proper data login with merchant account"_.

**Mobile vs desktop**: same component, responsive. Parcel list has explicit mobile/desktop variants and
a mobile filter modal. Four-sticker printing is desktop-only.

**Two findings worth recording.**

1. **The public tracker leaks internal errors.** An unauthenticated request for a bogus ID returns
   **HTTP 200** with `{"isError":true,"body":{"message":"Cannot read property 'PARTNER_NAME' of null"}}`.
   A 404-shaped condition answered 200 with a raw internal exception string.
2. **`sanitizeMessage()` rewrites competitor names to "RedX"** — the filter list is `["steadfast"]`,
   regex `gi`. Multi-carrier ShopUp parcels get re-branded in the tracking feed. This tells you RedX
   is an **aggregator arm of ShopUp**, not a pure-play network: a merchant may be served by whichever
   courier ShopUp routes them to.

The public page also carries a Google AdSense unit below the customer panel.

---

## 5. Technology

| Layer     | Finding                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework | **Next.js Pages Router**, React 18.3.1                                                                                                                  |
| Rendering | **Static export** — `data-n-g`, no `__NEXT_DATA__`. All content client-rendered after a CDN-cached shell.                                               |
| UI        | **Ant Design 5** (Table, Modal, Form, Timeline, Drawer, Steps, Dropdown)                                                                                |
| Forms     | Formik + Yup; phone regex `^(\+880\|880\|0)?1(1\|[3-9])[0-9]{8}$`                                                                                       |
| State     | Redux Toolkit — slices `auth`, `shop`, `allParcel`, `dashboard`, `language`, `issue`, `exportParcelHistory`, `reattemptList`, `landing`, `notification` |
| HTTP      | axios with **7 pre-configured clients**                                                                                                                 |
| Backend   | Versioned REST under `/v1`–`/v4` on Kong 3.1.1. No GraphQL, no gRPC.                                                                                    |
| Edge      | Cloudflare → nginx 1.31.6 + `server: envoy`                                                                                                             |
| Analytics | Segment + GA4 (`G-DVN5RVT5NY`)                                                                                                                          |

**Open API** — 11 documented endpoints, auth via `API-ACCESS-TOKEN: Bearer`:

```
GET  /parcel/track/{tracking_id}          POST /parcel
GET  /parcel/info/{tracking_id}           PATCH /parcels
GET  /areas                                GET  /areas?post_code=
GET  /areas?district_name=                 POST /pickup/store
GET  /pickup/stores                        GET  /pickup/store/info/{id}
GET  /charge/charge_calculator
```

Charge calculator takes `delivery_area_id`, `pickup_area_id`, `cash_collection_amount`, `weight`
(grams) and returns `{deliveryCharge, codCharge}`.

**Webhooks** — self-registered callback URL with a token query param; subscribe via
`/v4/subscription/merchant/{shopId}`. Payload:

```json
{ "tracking_number", "timestamp", "status", "message_en", "message_bn",
  "invoice_number", "delivery_type" }
```

⚠️ **No HMAC signature scheme documented. No retry or backoff policy. No delivery log. No event
catalogue beyond the status enum. No idempotency key concept anywhere in the API or the webhooks.**

❌ **No published OpenAPI spec.** `/swagger`, `/openapi.json`, `/api-docs` return the SPA shell or 404
on both production and sandbox. The docs page is hand-rolled React.
❌ **No published rate limits** — Kong is there but emits no `X-RateLimit-*` headers.

---

## 6. Commercial terms

**Published rate card** (FAQ, verbatim):

> The regular delivery charge (up to 1 kg) is **Inside Dhaka ৳65 · Dhaka Suburb ৳90 + 1% COD ·
> Outside Dhaka ৳120 + 1% COD**. Charges vary by weight and location.

**SLA** — inside Dhaka next day · Dhaka suburb 48 h · outside Dhaka 72 h, after pickup. Pickup window
**3–8 PM**, cutoff 3 PM. Max hold at last-mile hub 3 days. Cantonment and restricted areas deliver to
the gate.

**Settlement — the strongest published policy in this market.** **Next banking day after delivery**;
weekend and public holiday roll to the next banking day; **Saturdays processed for City Bank and
bKash** merchants, switchable any time. COD remittance Sunday–Thursday. Invoice issued at calendar
month end, payment due in **15 days**, disputes within **7 days**.

**Pricing model** — retail/SMB zone card above; B2B _"both **fixed rate & open rate** pricing"_ plus a
tiered volume incentive up to **21%** discount (Elite Rewards, on month-over-month parcel growth).

**Liability — read this before selling against them:**

- Undelivered 30 days after handover = **Lost**
- Liability capped at the **lower of invoice value or ৳5,000**, forward or reverse
- **No compensation for fragile items, liquids, or cooked/perishable food** — which is exactly why the
  create form has Fragile and Liquid toggles
- No refund where damage follows inadequate packaging; ghee, honey, oil and glass bottles excluded
- Customer must inspect goods **in front of the rider**
- Lost/damaged claims take **minimum 5 working days**
- ⚠️ **RedX may exercise a lien and set off collected COD against outstanding merchant dues**

---

## 7. Verdict

### Where RedX is strong

- **Payout speed** — next-banking-day with Saturday processing, published. Best in class.
- **Smart Return Pro** — reason-coded reattempt with a mandatory agent-performance audit trail. A real
  operational moat, not a feature list item.
- **Robocall verification** — call-record playback in the panel.
- **Coverage depth claim** — 64 districts, 493 sub-districts, 1,192 areas, 3,500+ agents.
- **COD economics** — 0% inside Dhaka is a sharp wedge.
- **Integration breadth** — the only one of the three with a **live sandbox plus both a Shopify app
  and a WooCommerce plugin**.
- **Verified granular RBAC** and a permission-comparison modal.

### Where RedX is weak

1. **No map, no ETA, no rider identity, no POD or signature for the end customer.** Pure text timeline.
   **The highest-value UX gap in the market.**
2. **The public tracker returns HTTP 200 with a raw internal exception** for unknown IDs, and has no
   rate limiting and no CAPTCHA — while the private APIs sit behind Kong. Inverted effort.
3. **3.6★ on 500K+ Play installs.** Actively maintained, poorly rated.
4. **SEO/SSR debt** — static export, zero server-rendered content, no `__NEXT_DATA__`.
5. **No in-product pricing** — no published slab table, no self-serve, enterprise is _"contact our
   agent"_.
6. **Liability capped at ৳5,000 with broad exclusions** (fragile, liquid, perishable) — a place to
   differentiate with clearer, configurable compensation.
7. **No documented rate limits, no OpenAPI spec, no webhook signature scheme, no idempotency keys** —
   painful for a merchant's engineers and a direct opening for a spec-first, self-serve platform.
8. **Webhooks have no retry or delivery log**, so a merchant cannot prove what was delivered.
9. **`sanitizeMessage` rebrands competitors** — structural evidence of an aggregator strategy, not a
   pure-play network.

### Cannot verify without a merchant login

Exact merchant-specific weight slabs and zone tables, surcharge configuration UI, whether slabs are
merchant-editable, real invoice layout, dashboard visual depth, the rider app, and the iOS app.

### What ZipZap should take from this

RedX publishes its rate card and pays out next banking day. **ZipZap publishes neither.** Before any
feature work, put a live quote in the product and a settlement projection on the console — RedX has
already proven the market reads that as the deciding factor. Their webhook story is the clearest
technical opening in Bangladesh: no signatures, no retries, no delivery log, no idempotency, no spec.
ZipZap already has all four (see [api/webhooks.md](../../api/webhooks.md) and
[ADR-0005](../../ADR/0005-transactional-outbox.md)); they are simply not exposed on a developer
portal yet.

---

Related: [carrybee.md](carrybee.md) · [steadfast.md](steadfast.md) · [_index.md](_index.md) ·
[../surfaces.md](../surfaces.md) · [../../api/webhooks.md](../../api/webhooks.md)
