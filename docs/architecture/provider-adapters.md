# Provider adapters

ZipZap integrates with payment gateways, SMS providers, email, and object storage. None of them
are trustworthy, none are fast, and none should be contacted during a test.

This page defines the seam. Everything on the other side of it is replaceable, and the local
fakes in [`infra/fakes`](../../infra/fakes) are one legitimate implementation of it.

---

## The rule

> **No provider's field names, error codes, or wire format appear outside
> `<module>/provider/`.**

The domain speaks `Money` and `TrxStatus`. A gateway speaks `"1008"` and `"120.00"`. That
translation happens in exactly one file per provider, and nowhere else.

If a controller or a use case contains the string `'status_code'`, the boundary has leaked.

---

## Interfaces

Declared by the domain, implemented by infrastructure. The dependency points inward.

```ts
// finance/rules/payment-provider.ts
export interface PaymentProvider {
  initiate(request: PaymentRequest): Promise<Payment>;
  verify(reference: string): Promise<Payment>;
}

// notification/rules/channel.ts
export interface NotificationChannel {
  readonly name: string;
  send(message: OutboundMessage): Promise<DeliveryReceipt>;
}

// common/storage.ts — shared, framework-free, no business rules
export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}
```

**The domain must not know a provider exists.** `finance/` does not import a PayStation file.
It imports its own interface, and Nest injects whichever implementation is bound in the
composition root.

---

## The money conversion problem

This is the single most important thing on this page.

**Every payment gateway we are likely to integrate with speaks decimal major units — `"120.00"`,
`120.50`, `"1"` — while our domain speaks integer minor units.**

```
domain          gateway
125050     →    "1250.50"
"1250.50"  →    125050
```

A gateway that sends `1250.5` for ৳1,250.50 loses nothing. A gateway that sends `1250.505` is
either rounding, or using a different minor unit, and **both must fail loudly** rather than
being silently truncated to `125050`.

The adapter is the only place this conversion happens:

```ts
// finance/provider/paystation.adapter.ts
function toMoney(paystationAmount: string): Money {
  // Parse as a DECIMAL STRING. Never parseFloat — see docs/ADR/0009.
  const parsed = parseMajorStrict(paystationAmount);
  if (parsed.minorUnits !== 2) {
    // A gateway sending anything other than 2 decimals is not behaving as modelled.
    throw new ProviderContractError('paystation', 'unexpected minor-unit precision');
  }
  return money(parsed.amountMinor, 'BDT');
}
```

Two rules that follow from ADR-0009 and are not negotiable:

- **Never `parseFloat`.** It cannot represent `1250.50` exactly.
- **Verify the scale on the way in.** Silent truncation of a provider amount is how a merchant
  is under-charged by ৳0.50 and nobody notices for a year.

---

## Transaction status mapping

PayStation's vocabulary is not ours. Ours is a closed enum; theirs is a string field with
documented values `processing`, `success`, `failed`, `refund`.

| Our `TrxStatus`   | PayStation   | Terminal |
| ----------------- | ------------ | -------- |
| `processing`      | `processing` | no       |
| `succeeded`       | `success`    | yes      |
| `failed`          | `failed`     | yes      |
| `refunded`        | `refund`     | yes      |
| **unknown value** | **throw**    | —        |

Note the casing trap, which is not hypothetical: PayStation's own documentation lists these values
in lowercase but its sample response shows `"Success"`, and its IPN section pins `"Success"`.
Match their literal output per endpoint, not your expectation of it.

An unrecognised status is **not** mapped to `failed` and **not** mapped to `processing`. It is
an error, because both mappings lose money:

- mapping unknown → `failed` means a successful payment is not recorded, and the merchant is
  short-paid until someone notices
- mapping unknown → `processing` means a failed payment sits unresolved, blocking settlement

Both are silent and both are expensive. Throw `ProviderContractError`, surface it, and let a
human decide. See [../operations/reliability.md](../operations/reliability.md).

---

## Error codes are in-band

PayStation returns errors **inside a 200 response**:

```json
{ "status_code": "1008", "status": "failed", "message": "Duplicate invoice number." }
```

So a provider adapter must branch on `status_code`, never on the HTTP status alone:

```ts
const body = await response.json();
if (body.status_code !== '200') {
  throw mapProviderError('paystation', body.status_code, body.message);
}
```

A `2xx` that means failure is a real and common pattern in this market. An adapter that trusts
the HTTP status will report successful payments that were rejected.

---

## What is verified, and what is not

| Adapter        | Contract status | Source                                                                                                  |
| -------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| PayStation     | **verified**    | [paystation.com.bd/documentation](https://paystation.com.bd/documentation), retrieved 2026-10-02        |
| MiMSMS         | **verified**    | [apidoc.mimsms.com](https://apidoc.mimsms.com), retrieved 2026-10-02 — Postman collection, SMS API v2.1 |
| Email          | real            | Mailpit (SMTP) locally, a provider adapter later                                                        |
| Object storage | real            | MinIO (S3-compatible) locally, a provider adapter later                                                 |

Email and object storage are _real_ implementations running locally, not fakes — Mailpit and
MinIO are genuine SMTP and S3 servers. Only the payment and SMS surfaces are simulated, because
those are the two where a public sandbox either costs money or does not exist.

---

## Phone number formats are not interchangeable

The single most likely integration bug, and **our two verified providers disagree with each
other**.

```
MiMSMS     8801844909020        no plus, no leading zero
E.164      +8801844909020       the international standard
```

MiMSMS's published spec is explicit: `mobileNumber` is `8801XXXXXXXXX`. Sending `+8801...` is
rejected.

So **"always normalise to E.164" is a harmful reflex here.** We store E.164 internally — see
[domains/customer.md](../domains/customer.md) — and the _adapter_ converts back to whatever the
provider expects. That conversion belongs in the adapter for exactly the same reason the money
conversion does: it is provider-specific, and getting it wrong is invisible until messages
silently fail.

```ts
// notification/provider/mimsms.adapter.ts
function toProviderMsisdn(stored: E164Phone): string {
  // +8801844909020 -> 8801844909020. MiMSMS rejects the plus sign.
  return stored.replace(/^\+/, '');
}
```

Normalising a number **for our records** and formatting one **for a provider** are two different
operations. Conflating them lets one provider's convention leak into the domain.

## Transactional vs promotional is a product decision, not a transport detail

MiMSMS's `transactionType` changes the rules, not just a label:

| Type                | Recipients    | DND                                   |
| ------------------- | ------------- | ------------------------------------- |
| `"T"` transactional | **exactly 1** | ignored — delivered regardless of DND |
| `"P"` promotional   | up to 1000    | restricted                            |

Every parcel notification is `"T"`. Two consequences:

- **Never batch parcel notifications into one `"P"` call.** DND restrictions would silently
  delay them, and per-recipient personalisation (`/api/V2/DSMS`) is a different endpoint.
- **The one-recipient limit is enforced by the gateway**, so a batching bug surfaces as a
  rejected request rather than a partial send. That is worth knowing: it fails loudly.

## The operator's retry policy is not ours

MiMSMS publishes a DLR table where each failure carries the **carrier's** retry count:

| DLR                                                                | Carrier retry policy |
| ------------------------------------------------------------------ | -------------------- |
| `Delivered`                                                        | 0                    |
| `Absent subscriber for SM`                                         | **3**                |
| `Subscriber Busy`                                                  | **3**                |
| `System failure` · `SMS Failed (SMSC link)` · `SMSC Timeout-abort` | **3**                |
| `Undelivered` · `Barred subscriber` · `Illegal subscriber`         | 0                    |

`Absent subscriber for SM` — the phone was switched off — is the most common real failure, and
the carrier will retry it **three times**.

**So a first-attempt delivery failure is not a permanent failure.** Retry policy `0` is the
only genuine permanent signal. Dead-lettering on the first failure discards messages that were
about to be delivered, which for a parcel notification means a customer who is never told their
parcel arrived.

`NotificationChannel.send()` returns a receipt; whether that receipt dead-letters must depend on
the carrier's retry policy, not on our optimism. See
[domains/notification.md](../domains/notification.md).

See [`infra/fakes/README.md`](../../infra/fakes/README.md) for the full verification table.

---

## Adding a real adapter

1. Implement the domain interface in `<module>/provider/`.
2. Map **only** at this layer: status vocabulary, error codes, and money.
3. Keep provider exceptions inside the adapter. The domain sees `PaymentProviderError`, not
   `PayStationError`.
4. Add the adapter to the composition root. Nothing else changes.
5. Keep the fake working. The local fakes implement the same interfaces, so both can be bound
   in different environments without a conditional in business logic.

```ts
// finance/provider/index.ts — composition, not logic
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

// development
{ provide: PAYMENT_PROVIDER, useClass: PayStationAdapter }

// staging
{ provide: PAYMENT_PROVIDER, useClass: RealPayStationAdapter }
```

The environment differs in exactly one line. That is the whole point.

---

## Webhooks and callbacks

Payment callbacks arrive at _our_ HTTP endpoints, not through the adapter. They are transport.

That makes them a different problem with a different failure mode:

- the gateway retries on any non-2xx, so **our handler must be idempotent**
- the body is untrusted input and must be validated before it changes state
- acknowledge fast; do the work after

PayStation's own documentation says the same IPN may arrive more than once and must be
deduplicated on `invoice_number` or `trx_id`. That is our idempotency layer
([api/idempotency.md](../api/idempotency.md)), and it is testable locally because
[`infra/fakes`](../../infra/fakes) actually retries against a failing receiver.

## Rate limits and backoff

Provider rate limits are the gateway's, not ours, and they differ per provider and per
merchant tier. The adapter owns retry and backoff; the domain never sleeps.

Backoff belongs in the adapter because only the adapter knows what a `503` from _this_ provider
means. Our own rate limiting ([api/rate-limits.md](../api/rate-limits.md)) protects _us_; the
adapter's protects the integration.
