# ADR-0008: Redis is never authoritative

**Status** accepted · 2026-10-02

## Context

Redis is used for caching, rate limiting, BullMQ, and short-lived locks. Those uses are fast and
cheap. It would be easy to let state accumulate there — session state, idempotency records,
progress counters — until the system's truth depends on a store designed to be fast rather than
durable.

## Decision

**PostgreSQL is the only source of truth. Redis holds only state that can be rebuilt or
regenerated, and no correctness decision may read from it.**

| Use           | Durability required | On Redis loss                |
| ------------- | ------------------- | ---------------------------- |
| Cache         | none                | cold cache, one slow request |
| Rate limiting | none                | limit not enforced briefly   |
| BullMQ queues | moderate            | in-flight jobs lost          |
| Locks         | none                | lock expires early           |
| Session cache | none                | re-read from Postgres        |

**No correctness decision reads Redis.** Not "usually" — never. A shipment's state, a COD record,
a ledger balance, and an idempotency decision are all Postgres.

### Rate limiting fails asymmetrically

**Redis down → mutations fail closed, reads fail open.**

Failing open on reads accepts unlimited tracking lookups during a Redis outage, which is cheap
and recoverable. Failing closed on mutations is what protects Postgres, the shared expensive
resource the limit exists to protect. Allowing unlimited writes to preserve availability trades a
throttling policy for database availability, which is the wrong trade.

### Session state

Sessions are authoritative in Postgres. Redis may cache them. A cache miss costs latency; a
cache entry that disagrees with Postgres loses sessions, which is a security problem.

## Consequences

### Positive

- A total Redis loss is a performance and throughput event, not a data-loss event.
- Recovery is "wait for the cache to rebuild".
- No code path can depend on Redis being up for correctness.
- The failure modes are easy to reason about.

### Negative

- **BullMQ job loss is real.** A lost job must be re-triggerable and idempotent.
- More Postgres reads than strictly necessary, since cache misses fall through.
- Rate limiting is briefly absent during a Redis outage.
- Explicitly more design work: every Redis use has to be argued as non-authoritative.

## Alternatives considered

**Redis as the session store.** Rejected: session revocation becomes eventual, and a session that
outlives a revocation is a security hole.

**Redis for idempotency records.** Rejected: an expired key means a duplicate request slips
through. Idempotency records are authoritative and live in Postgres — see
[ADR-0010](0010-idempotency.md).

**Postgres for everything, no Redis.** Rejected as unworkable: rate limiting a high-QPS public
endpoint at 100 req/min/IP means a write per request on the hottest table in the system.

**Memcached for caching.** Rejected: Redis was needed for BullMQ regardless, and running two
caches to save one is not a saving.
