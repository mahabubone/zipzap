# Steadfast Courier — competitive teardown

Research date **2026-10-08**. Method: live HTTP fetches, dashboard CSS/JS bundle analysis,
unauthenticated API probing, and app-store listing checks.

## How to read this

| Marker | Meaning                                                |
| ------ | ------------------------------------------------------ |
| ✅     | Verified from a fetched page, bundle, or live response |
| ◐      | Inferred; not directly confirmed                       |
| ❌     | Could not verify — login-walled or does not exist      |

⚠️ **The merchant dashboard is login-walled and was never rendered.** Section 2 is derived from the
**unauthenticated** dashboard bundles (`dashboard-2Ntzye8E.js` 132 KB, `add-parcel-*.js` 339 KB) that
are publicly served but only loaded on authenticated pages. High confidence on _what exists_; **no
claim is made about visual polish, layout, or which features ship enabled per plan.**

---

## 1. Who they are

|                      |                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| Founded              | 2016 (est. Sept 1)                                                                                            |
| Registered merchants | **300,000** (homepage, `/business`, Digi Bangla Sep 2026)                                                     |
| Delivery personnel   | 5,000 (homepage) / 7,500 (`/about`, `/business`) / "several thousand" (press) — ⚠️ **conflicting**            |
| Delivery points      | 1,000 · 8 divisional hubs (homepage) · 400+ hubs, 300+ vans, 10,000+ staff (iOS listing) — ⚠️ **conflicting** |
| Coverage             | 8 divisions · 64 districts · **495 upazilas** · 330 municipalities · 4,500+ unions                            |
| Main apps            | Android `com.steadfast.steadfast` — **1M+ downloads, 4.2★**, 2.98K reviews · iOS `id1644192533`, 3.5★         |
| Merchant apps        | Android `com.steadfast.steadfastmerchant` · iOS `id6745500991`                                                |
| Licence              | GPO-licensed; member CSAB + ECAB                                                                              |
| Leadership           | Founder & MD **KM Reidwanul Bari Zion**; Chairman **Joieria Mostary**                                         |

> **300,000 registered merchants against ~5.7M cumulative parcels (Grokipedia, secondary) is a very long
> tail.** The official Shopify app sits at **1.6★ with 77% one-star reviews**, and the WooCommerce
> plugin at 3.3★ with complaints about broken bulk actions. The long tail is being under-served, and
> that is where ZipZap can aim.

---

## 2. Product surfaces

| Surface                     | URL                                                                    | Login-walled                   |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------ |
| Marketing site              | `steadfast.com.bd`                                                     | No                             |
| **Public tracking**         | `/tracking?q=…` → `/tl/{token}`                                        | **No**                         |
| Pricing + live quote JSON   | `/pricing`, `/pricing/quote?…`                                         | No                             |
| Coverage + hub directory    | `/coverage`                                                            | No                             |
| Business/landing            | `/business`                                                            | No                             |
| Register / login            | `/register`, `/login`                                                  | —                              |
| **Merchant dashboard**      | `/dashboard`                                                           | **Yes** — 302 → `/login`       |
| Moderator login             | `/moderator/login`                                                     | Yes                            |
| **Merchant REST API v1**    | `portal.packzy.com/api/v1/*`                                           | Yes — `Api-Key` + `Secret-Key` |
| Marketing alt-domain        | `packzy.com`                                                           | No                             |
| Official Laravel package    | `steadfast-it/SteadFast-Courier-Laravel-Package` — 6,347 installs, 24★ | —                              |
| Official WooCommerce plugin | `wordpress.org/plugins/steadfast-api` — 8K active installs, 3.3★       | —                              |
| Official Shopify app        | `apps.shopify.com/steadfast` — free, Jun 2024, **1.6★ / 13 reviews**   | —                              |
| Official GitHub             | `github.com/steadfast-it` — 5 repos                                    | —                              |

❌ **No rider app.** Probed six plausible package IDs (`com.steadfast.rider`, `.agent`, `.delivery`,
`.courier`, `.riderapp`, `.steadfastrider`) — all 404. Only the merchant and main apps exist. Riders
almost certainly use an internal build. Both listings ship `RECORD_AUDIO` and location permissions,
consistent with an in-house rider build tool.

❌ **No API documentation of any kind.** `/docs`, `/api/docs`, `/swagger.json`, `/openapi.json`,
`/documentation`, `/sandbox` all 404. **No sandbox.**

⚠️ **The official SDK's default `base_url` is stale** — it points at `portal.steadfast.com.bd`, which no
longer resolves. The current host is `portal.packzy.com`.

⚠️ **The official GitHub WooCommerce plugin is a one-commit stub** missing all of its own
`includes/*.php` files.

---

## 3. Merchant dashboard — features

### 3.1 Architecture oddity

The dashboard is a **hand-written vanilla-JS shell with a Vue 3 island for add-parcel** — the
`add-parcel-*.js` chunk contains a full Vue runtime including `Symbol.for("v-scx")` scope IDs. Not
React, not Livewire, not Inertia. Built with Vite, output to `/build-v2/assets/` with a **publicly
readable `manifest.json`** listing all 12 entries — an unusual information leak that conveniently
exposed the whole asset graph.

### 3.2 Order creation and bulk

- **Create** — `POST /user/consignment/add/submit` (the Vue island)
- **Address autocomplete by phone** — `GET /user/recipients/by-phone/{phone}`; consignment lookup by
  phone too
- **Print label** — `GET /user/consignment/print-label/{id}`, opened via `window.open(…, "_blank")`;
  label-size selection and print-status feedback
- **Bulk import** — `data-sf-import` file input with an upload progress bar. Marketing claims **500
  orders per file**, "every row comes back with an ID and a tracking link"
- **Export** — date-range form with presets
- **Search** — async by mode (tracking code / invoice / phone) returning id, phone, invoice,
  tracking_code, cod, status
- **Pickup request** — estimated quantity + note, live estimate, rider info. Unlimited daily pickups;
  request by **16:00** for regular delivery

### 3.3 Fraud check — the standout feature

Enter a buyer's phone number and get back:

- delivery % and cancellation % as **donut gauges** (`stroke-dasharray` arcs)
- delivered and cancelled counts
- a **volume band** tile
- **auto-flagged fraud keywords** with repeat counts
- prior fraud reports against that number, with category labels, details, timestamps
- "reported by you" flag; last 5 searched numbers kept in `localStorage`

Plus merchant-initiated fraud reports against a consignment, and a general parcel-issue reporter with
a topic selector.

**This buy-risk-score-before-you-ship loop is the single most distinctive thing in Steadfast's
merchant software, and the clearest thing to beat.**

### 3.4 Payout and settlement — the densest area

- **Wallet** — `.sf-wallet`, `.sf-balance`, `.sf-ledger`, statements
- **Merchant-initiated payout request** — amount, live balance check, **hub picker with autocomplete**
  → _payout at a selected hub_
- **Add funds**, 1..max validated
- **Payout settings** — OTP-verified multi-step wizard (`details` → `otp`, 60 s resend), searchable bank
  accounts, per-method toggles for **bKash / Nagad / Rocket**, default method selector. Money rendered
  as `৳` + 2 dp with a true minus sign for negatives
- **Verification requests** with live status badges and approve/decline

Per T&C: bank transfer, bKash/Nagad/Rocket, **cash at HO and certain hubs**; **custom weekly payout
weekday on request**; merchants can only request disbursement from the panel.

### 3.5 Returns

T&C: a courier cancellation request is raised → **merchant approves** → parcel returns.
**"Steadfast Courier Ltd. does not charge for return parcels."** Zone change and resend are each
charged at the original rate. `.sf-returns` / `.sf-return-card` render the queue.

### 3.6 Reporting

`data-sf-stats` with period presets and custom ranges, `.sf-kpi`, `.sf-stat-card`, `.sf-mixbar`.
Marketing: _"Month-end reporting — deliveries, returns and COD, downloadable as a sheet."_
⚠️ **No charting library fingerprint** (no Chart.js, no ApexCharts) — this is server-rendered numbers
and bars, not a BI tool.

### 3.7 Staff and permissions — a deliberate half-choice

A **separate moderator login** (`/moderator/login`): _"Work in the merchant accounts that added you,
with the access they gave you… Switch between the accounts that added you."_ That is **multi-account,
merchant-scoped delegated access**.

⚠️ **No per-role permission matrix exists.** Zero matches for `role` / `permission` vocabulary in the
dashboard bundle. Moderation is binary "can/cannot see this account". A Play Store review complains
_"Moderator login system not added"_, so it may be recent and incomplete.
❌ **No multi-shop / sub-brand switching** for a single merchant account.

### 3.8 Security — ahead of both competitors

MFA (TOTP plus recovery codes) · **WebAuthn/passkeys** (`data-sf-passkey`, `/js/webauthn.js`) ·
password strength meter · OTP-verified password change · profile photo with client-side crop · KYC.

### 3.9 The best console UX details in this comparison

- **Command palette** — `Ctrl/Cmd+K` nav search with fuzzy scoring (`data-sf-navsearch`)
- **Favourites bar** (`data-sf-fav`)
- **In-dashboard API key management** — reveal, copy, revoke, **and a live credential tester** that
  POSTs the key and shows the JSON response
- **Webhook config** — callback URL validation, `http://` flagged with a warning, token charset
  validated
- **Support inbox** — ticket list, search, filter, threaded messages, attachments, WhatsApp panel with
  OTP
- **Announcements** with unread counts and dismiss
- **Bilingual English + বাংলা** with **Bangla numerals (০-৯)** throughout; locale route
  `/ui/locale/{bn|en}`
- In-app feedback widget — star rating, comment, chips

⚠️ **No call-log module found** — the call centre is hotline and WhatsApp only.

❌ **No notification-preference centre.** No map in the merchant tracker, no ETA, no call log.

### 3.10 API and webhooks

```
Base:  https://portal.packzy.com/api/v1
Auth:  Api-Key: <key>  +  Secret-Key: <key>
```

Verified endpoints: `create_order` (POST), `create_order/bulk-order` (POST, body
`{"data": "<json-string-array>"}`), `status_by_cid/{cid}`, `status_by_invoice/{invoice}`,
`status_by_trackingcode/{code}`, `get_balance`.

✅ **Published rate limits**: `x-ratelimit-limit: 1000`, `x-ratelimit-remaining` decrementing per call.
✅ **Undocumented failed-auth lockout**: `{"status":401,"message":"Unauthorized Access (invalid API
credentials)","attempts_left":9}` — observed ticking 9→8. A defensive touch neither competitor has.

**Webhooks** — outbound only, merchant-configured callback URL plus `Authorization: Bearer <token>`.
Payload: `consignment_id`, `invoice`, `status`, `cod_amount`, `updated_at`.
❌ **No inbound signature scheme. No replay protection. No retry policy. No delivery log. No event
types. No versioning.**

**Official status vocabulary** (SDK README):

```
pending · in_review · hold · delivered_approval_pending
· partial_delivered_approval_pending · cancelled_approval_pending
· unknown_approval_pending · delivered · partial_delivered · cancelled · unknown
```

Note the **`*_approval_pending` half-state family** — status changes are gated on merchant or admin
approval rather than being raw scans. A deliberate trust model worth comparing against ours.

### 3.11 Technology

| Layer        | Finding                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Server       | **Laravel** — `XSRF-TOKEN`, `sfc_user_session`, CSRF meta, 403/419 semantics                                                |
| Rendering    | SSR Blade for all public pages; dashboard is client-hydrated vanilla JS + one Vue 3 island                                  |
| Build        | Vite → `/build-v2/assets/`, publicly readable `manifest.json`                                                               |
| UI           | **Hand-rolled design system**, `sf-*` BEM-ish. No Bootstrap/Tailwind/MUI. Inline SVG icons from a server-injected map       |
| Fonts        | self-hosted Inter + Archivo woff2                                                                                           |
| CSS size     | dashboard 316 KB · dashboard JS 132 KB · add-parcel JS 339 KB                                                               |
| Analytics    | **Universal Analytics `UA-98358584-1`** (long-dead property) · Meta Pixel · GTM. **No GA4**                                 |
| Edge         | Cloudflare (WAF, Turnstile); `portal.packzy.com` is plain **nginx 1.24.0** on AWS ALB with `access-control-allow-origin: *` |
| Headers      | HSTS 1 year incl. subDomains · **CSP report-only** · **duplicate `x-frame-options: DENY` + `SAMEORIGIN`** · nosniff         |
| `robots.txt` | disallows only `/t/`                                                                                                        |

---

## 4. Public tracking UX — the smartest idea in this comparison

**The URL is `/tracking`, not `/track/`** (which 404s).

> "Where your parcel is right now — Paste the tracking link or code from your SMS. **No account
> needed.**"

Single `GET` form, `name="q"`, `inputmode="url"`, `autofocus`. Client-side JS validates the token
against `/^[A-Za-z0-9\-_]{20,64}$/`, extracts it from a pasted `/t/` or `/tl/` URL, then navigates to
`/tl/{token}`. Invalid input → inline error _"That does not look like a tracking link or code."_

**No phone field. No CAPTCHA. No Cloudflare Turnstile on this page** (Turnstile _is_ allow-listed in
the site CSP, so it guards login/OTP instead).

> **This is the key insight: Steadfast's public tracking is a single opaque, unguessable, per-parcel
> link — not a search by tracking ID + phone.** They deliberately abandoned ID+phone lookup; a Play
> Store reviewer asks for exactly that (_"if I get an SMS I can check it from any phone or PC using the
> tracking number without restrictions"_). The customer's only handle is the link in the SMS. There is
> **no CAPTCHA and no visible rate limiting** on `/tl/{token}` — the token _is_ the entropy.

**Result page:**

- **Tracking code** with copy-to-clipboard, plus a **status badge**
- **Facts** — parcel ID, invoice, COD amount, weight, created date/time, approved date (_"Not yet"_ if
  unapproved)
- **Contacts** — recipient (name, phone, address) and/or **rider (name + phone with a `tel:` Call
  button)**, or hub for point delivery. Phone is masked; `tel:` only offered when unmasked
- **Updates timeline** — `<ol>` with per-scan text and timestamp, newest marked `is-latest`, empty state
  "no updates"
- **Details** button deep-linking to the merchant-side view
- Help block — WhatsApp chat + hotline 09678-045045

**Absent from public tracking**: no map, no ETA, no proof-of-delivery photo, no signature, no
COD-due warning. An OpenLayers bundle exists in `add-parcel-*.js`, so a map exists somewhere in the
merchant product, but not on the tracking path.

**Mobile vs desktop**: one responsive codebase; the facts grid collapses to one column at 760px.
**Dark/light/system theme toggle** persisted in `localStorage['sf-theme']` and applied pre-paint by an
inline script. `prefers-reduced-motion` respected, `role="search"`, `aria-live` on the result,
skip-to-content link. **The most accessible public tracker in this comparison.**

---

## 5. Commercial terms

### Published rate card — pulled live from `/pricing/quote`

| Lane                                              | 1st kg home | Point delivery | Express |
| ------------------------------------------------- | ----------- | -------------- | ------- |
| Inside Dhaka                                      | **৳75**     | ৳60            | ৳110    |
| Dhaka → suburban / Gazipur / Narayanganj          | **৳105**    | ৳90            | n/a     |
| Dhaka → outside Dhaka                             | **৳135**    | ৳120           | n/a     |
| Within same district (e.g. Chattogram→Chattogram) | **৳60**     | ৳45            | ৳110    |

Extras: **+৳20 per additional kg** (verified — 5 kg = ৳135 + ৳80 = ৳215) · **COD fee 1%** ("Cash Handling
& Risk Management"), charged after the delivery charge · worked example: collect ৳2,000 → delivery ৳95
→ COD ৳19 → **merchant receives ৳1,901** · 0.5 kg inside Dhaka ৳65 home / ৳50 point · pick-and-drop
minimum ৳80 · max weight 600 kg · **VAT excluded** · **returns free**.

⚠️ **The homepage FAQ still advertises ৳70 / ৳100 / ৳130 and links to `/pricing.html`, which 404s.** Their
own marketing copy is stale by ৳5 per parcel. Small, but it is content-governance debt and it is
verifiable by anyone who looks.

**Calculator UX worth stealing** — six numbered steps (route → category → weight → service → delivery →
cash to collect), district autocomplete with a swap button, weight presets and a slider, and a **"Cash
to collect" input that live-recomputes what you actually receive**, with an itemised breakdown ending
in a **"you receive"** line. Plus a _"point delivery saves you ৳X"_ upsell and a sticky quote bar.

> **"Standard rates. Merchants on negotiated rates are billed on theirs."** No self-serve rate
> configurability — rates are negotiated offline.

**Service levels** — city wards same-day (Dhaka) · town wards next-day–2d · upazila HQ 2–3d · union 3–4d.
Same-day is **Dhaka Metro and CTG Metro only**, parcel entry before **11:00**. Pickup cutoff **16:00**.

---

## 6. Verdict

### Where Steadfast is strong

- **The token-based public tracker.** Opaque per-parcel link, no login, no CAPTCHA, no app install,
  bilingual, dark mode, and the most accessible implementation in the market. Explicitly contrasted
  against Pathao by their own users.
- **The fraud-check-before-you-ship loop** — donuts, volume bands, keyword flags, prior reports, local
  history.
- **OTP-verified payout settings** across bank + bKash/Nagad/Rocket, with **hub cash-out** and a custom
  weekly payout weekday.
- **Security depth nobody else has** — passkeys, MFA, live credential tester, in-panel API key rotation.
- **Console craft** — command palette, favourites bar, bilingual with Bangla numerals.
- **Published rate limits and failed-auth lockout.**
- **Free returns.** No charge for return parcels at all.

### Where they are weak

1. **No API docs whatsoever.** No OpenAPI, no sandbox, no versioning, no event catalogue — only an
   official Laravel package whose default base URL no longer resolves.
2. **Webhooks are primitive** — bearer token, no signature, no retries, no delivery log, no event types.
3. **No fine-grained RBAC** — moderator access is account-level, not permission-level. No staff seats
   with scoped roles, unlike RedX.
4. **Pricing is not self-serve** — negotiated offline; the public calculator shows "standard rates" only.
5. **Content and analytics debt** — FAQ stale by ৳5/parcel, dead `/pricing.html`, **Universal Analytics
   instead of GA4**, duplicate `x-frame-options`, report-only CSP.
6. **First-party integrations are poor where it hurts** — official Shopify app at **1.6★ (77% one-star)**,
   official WooCommerce plugin a one-commit stub missing its own files.
7. **No map, no ETA, no POD image, no signature, no call log, no notification preferences** in the
   merchant product.
8. **Mobile parity is weak** — reviews cite pickup-address save failures, rider reassignment without
   notice, and support non-response.
9. **No COD reconciliation tooling** beyond "download a sheet". No exception workflow for
   short / over / under-collected COD, no remittance verification.

### What ZipZap should take from this

Two things. First, **the opaque-token tracker.** ZipZap's `GET /track/:trackingCode` is public and
unauthenticated with 100 req/min per IP — but a tracking code is a guessable-enough, low-entropy
handle. Steadfast's per-parcel 20–64 char token is strictly better, and adopting it is a small change
to an endpoint we already own. Second, **the fraud-check loop**: we have `cod`, `returns` and the full
tracking event history, which is exactly the raw material for a customer-risk score, and nobody in this
comparison computes one from first principles.

Do **not** copy their webhook design — it is worse than ours by a wide margin.

---

Related: [carrybee.md](carrybee.md) · [redx.md](redx.md) · [_index.md](_index.md) ·
[../surfaces.md](../surfaces.md) · [../../domains/tracking.md](../../domains/tracking.md)
