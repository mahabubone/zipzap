# Local provider fakes

Local stand-ins for the external services ZipZap integrates with. **Never deployed.** They
exist so that local development and CI need no PayStation sandbox account, no SMS credit, and
no third-party uptime.

```bash
pnpm --filter @zipzap/fakes start     # :4010
pnpm --filter @zipzap/fakes test
```

---

## Read this first: what is verified and what is not

This is the most important thing in this directory. **Two** providers are reproduced from
published documentation. **One is an invented shape**, labelled as such in code, here, and in
the provider's own index response at `/`.

| Provider       | Status                            | Basis                                                                                                                                                                               |
| -------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PayStation** | **Contract-verified**             | [paystation.com.bd/documentation](https://paystation.com.bd/documentation), retrieved 2026-10-02. Endpoint paths, parameter names, error codes and response shapes are theirs.      |
| **MiMSMS**     | **Contract-verified**             | [apidoc.mimsms.com](https://apidoc.mimsms.com), retrieved 2026-10-02 — a Postman collection for **Bulk SMS API v2.1**. Endpoints, field names, limits and the DLR table are theirs. |
| **Moneybag**   | **⚠️ Shape-accurate, unverified** | Their site links an API reference that is not publicly reachable. Field and route names here are **ours**.                                                                          |

Verified on 2026-10-02:

| URL                               | Result                                                          |
| --------------------------------- | --------------------------------------------------------------- |
| `paystation.com.bd/documentation` | reachable, full API reference                                   |
| `apidoc.mimsms.com`               | reachable — Postman collection, full v2.1 spec extractable      |
| `moneybag.com.bd/documentation`   | **404**                                                         |
| `moneybag.com.bd/developers`      | reachable, but renders client-side; no API spec extractable     |
| `developer.sms.net.bd`            | reachable, states the site is inactive (a _different_ provider) |
| `mimsms.com`                      | reachable marketing site; specs live on `apidoc.mimsms.com`     |

**Why the distinction matters.** A fake that looks authoritative but is invented is worse than
no fake: it will pass CI, and then the first real integration will fail on field names nobody
checked. Anything unverified here is marked `⚠️` in the source file, in this table, and in the
provider's own index response at `/`.

When a real reference becomes available, **only that provider's file changes.** The product
talks to `PaymentProvider` and `NotificationChannel`, not to PayStation, MiMSMS or Moneybag — see
[../../docs/architecture/provider-adapters.md](../../docs/architecture/provider-adapters.md).

---

## Why a fake that can fail

A fake that returns `200 OK` tests nothing. The failure paths are where this product actually
breaks, so the fakes are built around three capabilities:

1. **Scriptable failure** — "fail the next two SMS sends, then succeed" is a deterministic,
   assertable outcome.
2. **Recorded calls** — `GET /_calls` returns what the product actually sent, including raw
   bytes, so a test can assert an HMAC signature verifies over the unmodified body.
3. **Retrying delivery** — the IPN dispatcher re-POSTs on non-2xx. This is the only way to
   prove the _receiver_ half of the idempotency contract.

---

## PayStation (verified)

Base URLs, from their docs:

```
sandbox   https://sandbox.paystation.com.bd
live      https://api.paystation.com.bd
```

Their published sandbox credentials are used, since they are published for exactly this
purpose: `merchantId 104-1653730183`, password `gamecoderstorepass`.

### Endpoints

| Route                                    | Auth                                           | Reproduced             |
| ---------------------------------------- | ---------------------------------------------- | ---------------------- |
| `POST /paystation/initiate-payment`      | `merchantId` + `password` in the form body     | yes                    |
| `POST /paystation/transaction-status`    | `merchantId` **header**, `invoice_number` body | yes                    |
| `POST /paystation/v2/transaction-status` | `merchantId` header, JSON `{ trxId }`          | yes                    |
| `GET /paystation/checkout/:trxId/:token` | none                                           | stand-in checkout page |
| Merchant IPN → your URL                  | none, gateway→merchant                         | dispatcher             |

### In-band error codes

Errors are **not HTTP statuses**. A failure returns HTTP 200 with a bad `status_code`:

```json
{ "status_code": "1008", "status": "failed", "message": "Duplicate invoice number." }
```

| `status_code` | Meaning                   |
| ------------- | ------------------------- |
| `"200"`       | ok                        |
| `"1008"`      | duplicate invoice         |
| `"2001"`      | invalid token / not found |

`1008` is reproduced by refusing a second `initiate-payment` for the same `invoice_number` —
which is the behaviour that lets a test prove our own idempotency layer is what actually
protects us, rather than the gateway.

### A documented inconsistency, reproduced on purpose

Their `trx_status` value list is lowercase (`success`, `failed`, `processing`, `refund`), but
their own sample response JSON shows `"Success"`, and their IPN section pins `"Success"`.

The fake emits **lowercase** from the status queries and **`"Success"`** in the IPN body,
matching each section literally. A receiver that lowercases one and not the other is exactly
the bug this asymmetry exists to expose.

### IPN, and why the dispatcher retries

From their docs, verbatim in substance: the IPN is a server-to-server `POST`, fired **only for
successful transactions**, carrying a flat JSON body
(`invoice_number`, `trx_status`, `trx_id`, `trx_amount`, `order_date_time`, `payment_method`,
`reference`).

Their receiver obligations, which are our contract to satisfy:

- return `2xx` quickly; do the heavy work after acknowledging
- **the same IPN may arrive more than once — guard against duplicate processing**
- never move an order from paid back to unpaid on a retried IPN
- verify `invoice_number` is known and pending, `trx_status` is `Success`, and `trx_amount`
  matches what was initiated

The default retry ladder here is `[0, 200, 500, 1000]ms` so a test finishes in seconds. Real
gating and backoff are the product's responsibility; the fake only needs to be able to
misbehave on demand.

---

## Moneybag (⚠️ unverified)

Models the shape every Bangladeshi gateway shares: create a charge → receive a hosted URL →
customer completes → async callback.

```
POST /moneybag/v1/charges          create; returns checkoutUrl
GET  /moneybag/v1/charges/:id      status
GET  /moneybag/checkout/:id        stand-in checkout page
```

Amounts are passed as **integer minor units** (`amountMinor`), matching our own
[Money](../../docs/architecture/money-and-ledger.md) convention rather than the decimal-major
convention their real API is more likely to use. That divergence is deliberate and documented
at the adapter boundary — see
[provider-adapters.md](../../docs/architecture/provider-adapters.md).

---

## MiMSMS — Bulk SMS API v2.1 (verified)

Reproduced from [apidoc.mimsms.com](https://apidoc.mimsms.com), which is a published Postman
collection. Endpoints, field names, limits and the DLR table are theirs.

```
POST /api/V2/SMS                   single send (T) or comma-separated list (P)
GET  /api/V2/Send                   the same, via query string
POST /api/V2/OneToMany              one message → smsData:[{ mobNumber }]
POST /api/V2/DSMS                   per-recipient message → smsData:[{ mobNumber, message }]
POST /api/V2/Schedule               ISO 8601, 30-minute intervals only
POST /api/V2/DlrApi                 delivery report by trackingId
POST /api/V2/BalanceCheck           credit balance
GET  /api/IncomingApi/PullSMS       inbound SMS pull
```

Auth is `apiKey` + `userName` **in the body or query**, never a header. The demo credentials
from their collection are used, since they are published for exactly this purpose:
`demo@mimsms.com` / `J6J68SNLDYG1SVS`, sender ID `8809612444598`.

### Four details that change how the product must be written

**1. Numbers are `8801XXXXXXXXX` — no `+`, no leading zero.**

Not E.164. The instinct to normalise everything to `+8801...` is _wrong for this provider_, and
that reflex is exactly what the assertion at `test/fakes.test.ts` exists to catch.

**2. `transactionType` changes the rules.**

`"T"` transactional allows **exactly one** recipient and ignores DND. `"P"` promotional allows
up to **1000** and is DND-restricted. A parcel notification is `T`. Sending two parcel
notifications in one `T` call is rejected by the gateway.

**3. A DLR carries the OPERATOR's retry policy, and it is not ours.**

Their published table maps each failure to a carrier retry count. Retry policy `3` means the
carrier will retry the handset itself:

| DLR                      | Retry policy |
| ------------------------ | ------------ |
| Delivered                | 0            |
| Absent subscriber for SM | **3**        |
| Subscriber Busy          | **3**        |
| System failure           | **3**        |
| SMS Failed (SMSC link)   | **3**        |
| SMSC Timeout-abort       | **3**        |
| Undelivered              | 0            |
| Barred subscriber        | 0            |
| Illegal subscriber       | 0            |

This changes our notification logic. `Absent subscriber for SM` is the single most common real
failure — the phone was off — and it is **retryable by the carrier**. Dead-lettering a message
on first failure discards one that was about to be delivered. Retry policy 0 is the only
permanent-failure signal.

**4. Access is gated before anything else.**

The API key must be _activated_, and the caller's **IP and domain must be whitelisted**, or
every call is refused. Both are toggleable at `/_sms/access` so a test can prove the adapter
surfaces this as an auth failure rather than a silent no-op.

### Response envelope

```json
{
  "statusCode": "200",
  "status": "Success",
  "trxnId": "TRX6391610625331410870",
  "message": "SMS submitted successfully.",
  "data": [ … ]
}
```

`statusCode` is a **string**, not a number — the same class of trap as PayStation's in-band
errors.

The envelope is verified from their BalanceCheck documentation, the only endpoint with
documented response fields. The _contents_ of `data[]` for the send endpoints are **inferred**
and marked as such in the source.

Their BalanceCheck response uses the spelling **`expair_Date`**. It is reproduced: silently
normalising a provider's field name breaks the integration the first time someone reads a real
response.

### Test-only routes

Not part of their API:

| Route                                   | Purpose                                      |
| --------------------------------------- | -------------------------------------------- |
| `POST /_sms/:trackingId/dlr?name=…`     | apply a DLR outcome from the published table |
| `POST /_sms/access`                     | toggle whitelisting / key activation         |
| `GET /_sms/records` · `/_sms/dlr-codes` | inspect sends and the DLR table              |

```bash
# Prove the carrier-retry insight: policy 3 is not a permanent failure.
curl -X POST 'localhost:4010/_sms/TRX.../dlr?name=Absent%20subscriber%20for%20SM'
```

## Control plane

Everything lives under `/_` so it cannot collide with a provider route.

| Route                                               | Purpose                                      |
| --------------------------------------------------- | -------------------------------------------- |
| `GET /_calls?provider=&operation=&since=`           | what the product sent, with raw bodies       |
| `GET /_cursor`                                      | current sequence, for `since`                |
| `POST /_reset`                                      | return the whole process to a known state    |
| `POST /_script`                                     | add a fault rule                             |
| `GET /_rules`                                       | list rules and how many times each has fired |
| `POST /_paystation/:invoice/complete`               | drive a payment, fires the IPN               |
| `POST /_paystation/:invoice/refund`                 | move a transaction to `refund`               |
| `GET /_ipn-log`                                     | every IPN attempt, with status codes         |
| `POST /_ipn-config`                                 | set the IPN destination and retry ladder     |
| `GET /_paystation` · `/_moneybag` · `/sms-messages` | current state                                |

### Scripting a failure

```bash
# Fail the next two SMS sends with a 503, then behave normally.
curl -X POST localhost:4010/_script -H 'content-type: application/json' -d '{
  "provider": "sms",
  "operation": "send",
  "times": 2,
  "outcome": { "kind": "httpError", "status": 503 }
}'

# Reject a specific invoice number, simulating a duplicate at the gateway.
curl -X POST localhost:4010/_script -H 'content-type: application/json' -d '{
  "provider": "paystation",
  "operation": "initiate-payment",
  "field": "invoice_number",
  "fieldEquals": "SET-001",
  "outcome": { "kind": "reject", "statusCode": "1008", "message": "Duplicate invoice number." }
}'
```

`outcome.kind` is one of `reject`, `httpError`, `trxStatus`, `timeout`.

### Asserting what the product sent

```bash
curl 'localhost:4010/_calls?provider=sms&since=0' | jq '.calls[].body'
curl 'localhost:4010/_calls?provider=paystation&operation=initiate-payment'
```

`rawBody` is preserved verbatim because **re-serialising a parsed body changes key order and
breaks HMAC verification** — the exact failure documented in
[docs/api/webhooks.md](../../docs/api/webhooks.md).

### Driving the failure story end to end

```bash
# 1. Point IPN delivery at a receiver that will 500.
curl -X POST localhost:4010/_ipn-config -H 'content-type: application/json' \
  -d '{"url":"http://localhost:4010/_never-ack"}'

# 2. Create a transaction, then complete it.
curl -X POST localhost:4010/paystation/initiate-payment \
  -d 'merchantId=104-1653730183&password=gamecoderstorepass&invoice_number=SET-001&payment_amount=1250&cust_name=Ayesha&cust_phone=01700000000&cust_email=a@example.com'
curl -X POST 'localhost:4010/_paystation/SET-001/complete?status=success&method=bKash'

# 3. Read what actually happened.
curl localhost:4010/_ipn-log | jq '.[] | {delivered, attempts: [.attempts[] | .status]}'
```

`delivered: false` with a growing `attempts` array is the retry ladder being exercised.

---

## In CI

`test/` uses `app.request()` — no port, no container, no sleep.

```bash
pnpm --filter @zipzap/fakes test
```

The suite asserts the verified contract (PayStation field names, error codes, IPN shape), the
retry behaviour, the determinism of scripting, and that the one unverified provider is clearly
marked. When a real provider reference lands, the failing test should be the one that says
"this shape was a guess".

## What this directory must never contain

No real credentials. No live-provider calls. No dependency from `apps/backend` — the product
does not know these exist; it only knows the interfaces in
[provider-adapters.md](../../docs/architecture/provider-adapters.md).
