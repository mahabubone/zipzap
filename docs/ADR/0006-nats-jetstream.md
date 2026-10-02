# ADR-0006: NATS JetStream as the event transport

**Status** accepted · 2026-10-02

## Context

Decoupled consumers need durable, replayable, ordered-per-key event delivery. Modules must be
able to react to facts without knowing who is listening.

## Decision

**NATS JetStream carries all domain and integration events.**

Subjects: `zipzap.<aggregate>.<fact>`, lowercase, past tense.

```
zipzap.shipment.delivered
zipzap.cod.collected
zipzap.settlement.completed
```

Consumers: `tracking` · `notification` · `analytics` · `finance` · `webhook`.

Supporting decisions:

- **Events describe business facts, not row changes.** `ShipmentDelivered`, never `RowUpdated`.
- **Version in the payload**, not the subject — adding a field is then a compatible change.
- **Payloads carry identifiers and amounts**, not table snapshots.
- **NATS is not authoritative.** Postgres holds the truth; JetStream is a transport. Losing it
  costs freshness, not data — the outbox is the durable record ([ADR-0005](0005-transactional-outbox.md)).

## Consequences

### Positive

- Small, fast, low operational overhead for the volume here.
- Subject-based routing means consumers subscribe to facts, not to modules.
- **JetStream's persistence gives replay**, so a projection can be rebuilt from events without
  re-reading history — which is what makes `analytics:rebuild` possible.
- Per-subject ordering is enough for aggregate correctness.
- One binary in local dev and in production.

### Negative

- Delivery is at-least-once, so **every consumer must be idempotent**. Not a style preference.
- Ordering is per-subject, not global. Correctness comes from the state machine rejecting
  invalid transitions, not from message order.
- A smaller ecosystem than Kafka or RabbitMQ — fewer libraries, fewer Stack Overflow answers.
- JetStream clustering is a thing to learn before it is needed, not a thing to learn now.

## Alternatives considered

**Kafka.** Rejected: correct for high-throughput log processing. Here it is a large operational
surface for a modest event volume. Revisit if event throughput becomes a measured problem.

**RabbitMQ.** A reasonable alternative, and the closest one. Rejected for subject-based routing
fitting the event model better, a simpler operational story, and native ordered replay.

**Postgres as the queue** (a `LISTEN`/`NOTIFY` or polling loop on the outbox). Rejected: couples
consumer scaling to database connections, and re-implements a broker badly.

**Redis Streams.** Rejected: Redis is explicitly non-authoritative
([ADR-0008](0008-redis-responsibilities.md)), and event durability should not rest on the same
store as cache and rate limits.

**In-process EventEmitter.** Rejected: no durability, no replay, and no crossing a process
boundary — so it would have to be replaced before any consumer could be scaled independently.
