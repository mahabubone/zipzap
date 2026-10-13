# Architecture Decision Records

Seventeen decisions. Each records the alternatives, because a decision without its rejected
options cannot be revisited by anyone who was not in the room.

## Format

```
Status      proposed | accepted | superseded by ADR-XXXX
Context     what forced a decision
Decision    what we chose
Consequences what it costs, honestly
Alternatives what we rejected, and why
```

**Supersede, do not edit.** An ADR that changed under you has lost its value — the point is to
show what was believed at the time. Write a new one and mark the old `superseded`.

## Index

| #                                            | Decision                                                  | Status   |
| -------------------------------------------- | --------------------------------------------------------- | -------- |
| [0001](0001-modular-monolith.md)             | Modular monolith over microservices                       | accepted |
| [0002](0002-postgresql-schema-boundaries.md) | One schema per module, no cross-schema access             | accepted |
| [0003](0003-typeorm-migrations-first.md)     | TypeORM with migrations, never `synchronize`              | accepted |
| [0004](0004-swagger-generated-openapi.md)    | OpenAPI generated from decorators                         | accepted |
| [0005](0005-transactional-outbox.md)         | Transactional outbox for event publication                | accepted |
| [0006](0006-nats-jetstream.md)               | NATS JetStream as the event transport                     | accepted |
| [0007](0007-bullmq.md)                       | BullMQ for background work                                | accepted |
| [0008](0008-redis-responsibilities.md)       | Redis is never authoritative                              | accepted |
| [0009](0009-money-representation.md)         | Integer minor units + currency                            | accepted |
| [0010](0010-idempotency.md)                  | Mandatory `Idempotency-Key` on money and physical actions | accepted |
| [0011](0011-postgis.md)                      | PostGIS with `geography`, not `geometry`                  | accepted |
| [0012](0012-rider-offline-sync.md)           | Offline queue with per-command idempotency                | accepted |
| [0013](0013-settlement-ledger.md)            | Append-only ledger, derived balances                      | accepted |
| [0014](0014-future-service-extraction.md)    | Extraction is a decision, not a plan                      | proposed |
| [0015](0015-local-provider-fakes.md)         | Local provider fakes over real sandbox accounts           | accepted |
| [0016](0016-http-only-sessions.md)           | HttpOnly sessions behind a same-origin proxy              | accepted |
| [0017](0017-integration-test-harness.md)     | Integration tests wire their graph through one harness    | accepted |

## Template

```markdown
# ADR-XXXX: Title

**Status** accepted · 2026-10-02

## Context

## Decision

## Consequences

### Positive

### Negative

## Alternatives considered
```
