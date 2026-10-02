# ADR-0002: One schema per module, no cross-schema access

**Status** accepted · 2026-10-02

## Context

Rule 2 in [`../AGENTS.md`](../AGENTS.md). Every "just this one query" across module boundaries is
how a modular monolith stops being one. A join is a permanent, invisible dependency that escapes
the type system, survives code review, and makes extraction impossible.

## Decision

**Each module owns exactly one Postgres schema. No module reads or writes another's tables.**

Not through a JOIN. Not through a repository. Not through raw SQL. Not "just for reporting".

```
shipment.shipments        ──✗──JOIN──▶  merchant.merchants
delivery.delivery_jobs    ──✗──▶ UPDATE rider.riders
```

Cross-module communication is either an **injected service** (synchronous, when the caller needs
a value to proceed) or an **event** (asynchronous, when it needs to react). No cross-schema
foreign keys — a `rider_id` in `delivery` is a bare identifier, not a constraint.

### Enforced, not documented

1. **One TypeORM connection per module, scoped to its schema.** A cross-module query fails at
   runtime rather than silently succeeding in production.
2. **`domain/` imports no framework.** No `@nestjs/*`, no `typeorm`, no `class-validator`, no
   `bullmq`. Keeps business rules honest about their dependencies.
3. **A CI grep** for cross-schema SQL and cross-module infrastructure imports.

## Consequences

### Positive

- Every module is independently testable and independently understandable.
- A module's data can be moved without touching others — the precondition for extraction.
- Schema changes are owned by exactly one team.
- Refactoring across modules is a local change.

### Negative

- **Real friction.** Reporting across domains needs N explicit calls or an event-fed projection.
  This is a cost, paid deliberately.
- The CI grep is crude. It catches carelessness, not every violation.
- Support agents need cross-domain reads, which is more code than one six-table join.
- A denormalised field must be updated by events, so it is briefly stale.

## Alternatives considered

**Cross-schema foreign keys.** Rejected: `delivery` would fail to write if a rider row was
deleted, coupling their lifecycles. Referential integrity across modules is an application
concern, not a database one.

**One schema, prefixed tables** (`shipment_shipments`, `delivery_jobs`). Rejected: real
separation, but `search_path` and grants get complicated, and a cross-module query is one
missing qualifier away.

**A schema per module with database views across them.** Rejected: a view is a join with extra
indirection. It looks like a boundary and is not one.

**No database at all; events as the source of truth.** Rejected: reconstructing current shipment
state from an event log to answer "where is my parcel" is a large amount of machinery for a
question Postgres answers in one indexed lookup.
