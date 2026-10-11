---
title: The questions we get asked most
description: Money, retries, cadence and the things that look like bugs and are not.
order: 1
audience: all
---

## Money

### Is a decimal amount rounded?

No — it is **refused**. Money is integer minor units (poisha) plus a currency, stored as `bigint`
and computed with integer arithmetic. `125050` poisha is 1,250.50 taka. A decimal anywhere is a bug
in the caller, and the error names the field.

### Where does a shortfall go?

It is recorded, not absorbed. A rider who collected 200 poisha against a frozen quote of 500 has a
**shortfall of 300**, and that difference is what the reconciliation queue is for. The quote itself
is never rewritten by a collection.

### When does money move?

A settlement is created from whatever is unsettled, then approved, then paid. `settlements:approve`
moves money out of the account, which is why it is owner-only.

## Errors

### I got 404 for a parcel that exists

Two possible reasons: it is another business's parcel — **the API tells 404 rather than 403, so a
cross-tenant id is indistinguishable from a nonexistent one** — or the tracking **projection** is
behind. The tracking timeline is built by the worker: if `/track/:code` 404s for a shipment that
exists, check the worker before anything else.

### I got 429 and my retry also 429'd

Honour `Retry-After`. Mutations fail **closed** (they refuse rather than open the limit) while reads
fail **open** (a Redis outage does not take tracking down), so a 429 on a read and a `503` on a write
are different failures with different recovery.

### Why did my 401 say nothing about the cookie?

Because a `Authorization` header naming an unrecognised scheme is **rejected, not ignored**. The
server will not fall through to a cookie when you have sent a header that names neither `Bearer`
nor `ApiKey`.

## Cadence

### Why is the tracking timeline eventually consistent?

It is a **projection** built from the outbox, not the authoritative table. The authoritative record
is the tracking log; the timeline is what the API returns because it is what a customer can read
without leaking internal detail.

### Do webhooks retry? Will I get duplicates?

Yes, and yes. `1m → 5m → 15m → 1h → 6h → 24h`, then terminal. `4xx` other than `429` is not
retried. Deduplicate on `ZipZap-Delivery`.

## Access

### Can I act inside two businesses at once?

Yes — a person holds **memberships**, and one login can operate inside several. Your active
business is on the principal (`GET /v1/me`), and the role is **per membership**, so you may be an
owner of one and an operator of another.

### I removed a colleague from the console but they still had access

That cannot happen now: removing a member **revokes every session they hold immediately**. It used
to, before 2026-10-11 — the fix was part of the same change that added membership management.
