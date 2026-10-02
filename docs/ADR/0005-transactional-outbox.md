# ADR-0005: Transactional outbox

**Status** accepted · 2026-10-02

## Context

Every mutation must do two things: change state and announce the fact. Doing both atomically
across Postgres and a message broker is not possible with either technology alone.

Publishing to NATS inside a transaction has two failure modes. Publish first and a rollback
leaves a message describing something that never happened — a merchant gets a webhook for a
shipment that does not exist. Commit first and a crash between the two loses the event silently —
the parcel is delivered and no projection, notification, or webhook ever learns about it.

Both are unacceptable, and the second is invisible until someone notices a customer was never
told their parcel arrived.

## Decision

**Write an outbox row in the same transaction as the state change. A separate publisher process
drains it to NATS.**

```sql
BEGIN;
  UPDATE shipment.shipments SET status = 'delivered' WHERE id = $1;
  INSERT INTO tracking.events      (...);
  INSERT INTO system.outbox_events (...);
COMMIT;
```

```sql
SELECT … WHERE published_at IS NULL ORDER BY id LIMIT 100
FOR UPDATE SKIP LOCKED
  → publish to JetStream → UPDATE published_at = now()
```

`publisher.ts` is the only process permitted to publish to NATS. `SKIP LOCKED` lets several
replicas run without blocking each other, and a crashed publisher loses nothing — an unpublished
row is simply picked up again.

## Consequences

### Positive

- **No dual-write inconsistency.** State and event commit together or not at all.
- **NATS being down does not stop transactions.** Outbox rows accumulate; the publisher retries.
  This is the single most valuable property of the decision.
- A crashed publisher loses nothing.
- Delivery is **at-least-once**, so consumers must be idempotent — which is a stated, tested
  requirement rather than a hope.

### Negative

- **Delivery is at-least-once, not exactly-once.** Consumers must dedupe via
  `system.consumed_events`. Not optional.
- An extra table and an extra process to operate.
- Slight propagation delay: the publish happens after the commit, not inside it.
- `outbox_pending` is a metric to alert on, or events go stale unnoticed.

## Alternatives considered

**Publish inside the transaction.** Rejected: no way to roll back a message, and no way to know
whether the message was accepted before the commit.

**Two-phase commit between Postgres and NATS.** Rejected: NATS does not participate in XA, and
distributed transactions are a large operational liability for a two-system problem that an
eventually-consistent outbox solves.

**Change Data Capture (Debezium).** Rejected as a good fit: it captures row changes, so
subscribers couple to your table layout, and a migration becomes a breaking change for every
consumer. It is also a substantial operational dependency. Revisit if the outbox table itself
becomes a bottleneck.

**Listen on Postgres `NOTIFY`.** Rejected: not durable, limited payload, lost if no listener is
attached. It is a trigger, not a queue.

**Skip events; make everything synchronous.** Rejected: couples availability of notification,
analytics, and webhook delivery to availability of shipment creation.
