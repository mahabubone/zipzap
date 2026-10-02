# Rate limits

Separate policies per tier. One global limit is always wrong for someone.

## Tiers

| Tier               | Limit                     | Basis               |
| ------------------ | ------------------------- | ------------------- |
| Public tracking    | 100 req/min               | per IP              |
| Merchant API       | configurable per contract | per merchant        |
| Authentication     | 20 req/min, burst 5       | per IP + credential |
| Webhook management | 30 req/min                | per merchant        |
| Admin API          | 60 req/min                | per user            |

These are starting points. Production values get tuned from real traffic, not from a blog post.

## Track and bulk need different treatment

Tracking reads are frequent and cheap — merchants embed them. Shipment creation is expensive and
rare.

A shared limit forces the strictest policy on the most common operation, or the loosest policy
on the most expensive one. Neither works.

## Headers

```
RateLimit-Limit: 100
RateLimit-Remaining: 42
RateLimit-Reset: 42
X-RateLimit-Policy: 100;w=60
```

Follow the `RateLimit-*` draft rather than `X-RateLimit-*`. The `X-` prefix means
"experimental", and clients are increasingly ignoring it.

## 429

```json
{
  "type": "https://api.zipzap.example/errors/rate-limited",
  "title": "Too many requests",
  "status": 429,
  "code": "RATE_LIMITED",
  "detail": "Limit of 100 requests per minute exceeded. Retry after 42s.",
  "request_id": "req_123",
  "retry_after_seconds": 42
}
```

Plus `Retry-After: 42` as a header. It is the only thing a generic HTTP client will read, and a
merchant's SDK will not parse our JSON to find it.

## Redis is the right store, with one condition

Counters live in Redis — it is the only shared store available to every process, and sliding
windows are its natural shape.

**But if Redis is unavailable, fail closed on mutations and fail open on reads.**

Failing open on reads means a Redis outage silently removes the limit — acceptable, because
tracking is cheap and a merchant dashboard is not a DoS vector. Failing closed on mutations
means a Redis outage rejects shipment creation.

That asymmetry is deliberate. Rate limiting exists to protect a shared expensive resource.
Postgres is the shared expensive resource. Allowing unlimited writes during a Redis outage to
preserve availability would trade a rate-limit policy for database availability, and that is the
wrong trade.

## Authentication is strictest

Brute-force protection is a different goal from API fairness. Strict limits, short bursts,
lockout with progressive backoff, and every failure logged with `request_id`, credential, and
IP.

Do not reveal whether a credential exists. A reset-password or login endpoint that distinguishes
"no such user" from "wrong password" is a user-enumeration oracle — use one message and one
status for both.

## Per-merchant configuration

Limits live in the merchant contract. A large merchant with 50,000 shipments a day is not
malicious and should not be throttled like one sending 50.

`last_used_at` on the credential is what tells you who is actually near their limit, and it is
worth reviewing before tightening a default.

---

Related: [errors.md](errors.md) · [auth.md](auth.md) ·
[../domains/merchant.md](../domains/merchant.md)
