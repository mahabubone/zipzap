---
title: Idempotency keys, and why your first order got created twice
description: The one header that makes a retry safe, and what happens when you send it twice.
order: 2
audience: merchant
---

## The rule

Anything that **creates or moves** state requires an `Idempotency-Key` header:

- shipment create
- bulk import
- COD collect
- delivery confirm
- settlement approve
- rider offline sync

Without it the request is refused. This is not optional and it is not advisory — a shop whose
network flaps mid-request and retries will create two shipments, and they will be two shipments at
two different prices.

## What counts as a safe key

Generate it **client-side, before the request**, and persist it against the intent. A UUID is fine:

```bash
curl -X POST https://api.zipzap.com/v1/shipments \
  -H "Authorization: ApiKey $KEY_ID.$SECRET" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

The key is scoped to the endpoint and the credential. Replaying it:

- **within the TTL** (24 hours) returns the **original response**, with `replayed: true` in the body
  — so you can tell a replay from a fresh result
- **after the TTL** is treated as a new request

The server stores the outcome, not the request. So a key whose first attempt failed validation is
replayed with the same failure rather than being re-validated against a corrected body.

## What this does not cover

Idempotency protects against a **retry of your own request**. It does not protect against:

- **Two attempts with different keys.** If you generate a key per attempt instead of per intent,
  you get two shipments. The key must be deterministic for a given logical operation.
- **A duplicate that arrives through a different path** — a merchant placing the same order twice by
  clicking twice is not a retry, and there is no way for the server to know.

Use a key derived from your own order id: `so-${orderId}-step-${step}`.

## Next

Once shipments are flowing, you will want to know when one is delivered rather than polling — that
is [webhooks](/merchant-onboarding/03-webhooks).
