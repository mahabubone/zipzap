# Module boundaries

This is the rule that shapes every other decision. If a change here is contentious, it is
probably the most important change in the repo.

---

## The rule

> A module owns its schema. No module may read or write another module's tables.

Not through a JOIN. Not through a repository. Not through raw SQL. Not "just for reporting".
Not "it's the same database".

```
shipment.shipments  ──✗──JOIN──▶  merchant.merchants
delivery.delivery_jobs ──✗──▶ UPDATE rider.riders
```

Delivery stores `rider_id`. It does not know whether that rider is online. If it needs to know,
it asks the rider module, or waits for an event.

## Two legal channels

**Synchronous** — an injected service from the owning module, when the caller genuinely needs a
value to proceed:

```ts
// In delivery/delivery.service.ts
const rider = await this.riders.getAvailableForZone(zoneId);
```

The owning module exposes a contract. The caller's DTO carries the value forward. Ownership of
the data never moves.

**Asynchronous** — an event, when the caller needs to react rather than to know:

```
delivery → outbox → NATS → analytics consumer
```

Prefer events. A synchronous call creates a runtime dependency the owning module cannot see.

## Why it is worth this much friction

A table join is a permanent, invisible dependency. It survives code review, it escapes the type
system, it cannot be found by a grep, and it makes the module impossible to extract later.

The rule is not about tidiness. It is about being able to answer, in one sentence, what happens
to a shipment. If `delivery` can see rider tables, the answer is "everything, in a join".

## Enforcement

Documentation is not enforcement. Three mechanisms:

**1. One TypeORM connection per module, scoped to its schema.**

```ts
TypeOrmModule.forRootAsync({
  name: 'shipment',
  schema: 'shipment', // the connection only ever sees this schema
  entities: [ShipmentEntity, TrackingEventEntity],
});
```

With a schema-scoped connection, a cross-module query fails at runtime rather than silently
succeeding in production and confusing someone later.

**2. Pure rules import nothing.**

Files in `rules/` may not import `@nestjs/*`, `typeorm`, `class-validator`, or `bullmq`.
The TypeORM entity (`shipment.entity.ts`) lives beside them but outside the `rules/`
marker; it is a row shape, not business logic. Domain errors are plain `Error` subclasses.
This keeps the business rules honest about what they depend on.

**3. A CI grep.** `pnpm boundaries:check` enforces, in order of how much each costs when missed:

```
FORBIDDEN: SELECT/INSERT/UPDATE/JOIN against a schema the module does not own
FORBIDDEN: imports of another module's *.entity.ts
FORBIDDEN: framework imports in rules/ files
FORBIDDEN: provider wire tokens outside <module>/provider/
FORBIDDEN: decimal literals on money-shaped names
```

It is crude. It catches the careless cases, which is most of them.

## Cross-cutting modules

Two things are not business domains but must exist.

**`system`** — owns `system.outbox_events` and the outbox publisher. Every module writes here.
That is the one deliberate exception to module isolation, because the outbox is the mechanism
that makes isolation possible. Writing to it costs no coupling: `system` knows nothing about any
module's business.

**`common`** — framework-free shared primitives: `Money`, domain error types, the §87 envelope,
idempotency. No business rules. If something in here knows what a shipment is, it is in the wrong
place.

## Domain event vs database change

```
Domain event:     ShipmentDelivered
Database change:  shipment.status = 'delivered'
```

The row update is how we _record_ that delivery happened. It is not the fact itself. If you
publish `row.updated` you have built a CDC pipeline, not a business event — subscribers now
depend on your table layout, and a migration breaks them.

Events are named in the past tense, carry identifiers and amounts rather than table snapshots,
and mean the same thing regardless of which table currently holds the state.

See [eventing.md](eventing.md).

## CQRS is logical

Separate command and query services. One database. No read replicas.

Splitting read and write infrastructure is a scale decision with a real cost — replication lag,
two sources of truth, eventual consistency in places we promised strong consistency. Not now.
See [../ADR/0014-future-service-extraction.md](../ADR/0014-future-service-extraction.md).

## Where the boundary gets tested

The rule is easy to state and easy to violate accidentally. Ask these when reviewing:

- Does this query touch a schema you do not own?
- Is a `rider_id` here a foreign key, or just an identifier? _(It is just an identifier.)_
- Could this module run if that other module's tables were dropped?
- Is the service you injecting exposing its entity, or a DTO?
- Does an event carry a domain fact, or a table row?
