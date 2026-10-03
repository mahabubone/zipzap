# Architecture overview

One application. Many modules. Clear boundaries.

```
                    Merchant Web   Ops Tower   Hub   Admin   Rider   Desktop
                          \           |        |      |       |       /
                           \__________|________|______|_______|______/
                                          │
                                          ▼
                              apps/backend  ·  NestJS 12
                     ┌───────────────────────────────────────────┐
                     │  ONE module graph, THREE entrypoints      │
                     │                                           │
                     │  main.ts        HTTP API, Swagger        │
                     │  worker.ts      BullMQ + NATS consumers   │
                     │  publisher.ts   outbox → NATS            │
                     │                                           │
                     │  18 domain modules, one schema each       │
                     └───────────────────────────────────────────┘
                          │            │             │
                    PostgreSQL      Redis         Outbox
                    + PostGIS    (never truth)      │
                                                    ▼
                                              NATS JetStream
                                                    │
                                        ┌───────────┼───────────┐
                                        ▼           ▼           ▼
                                    tracking   notification  analytics · webhook
                                                                     │
                                                                     ▼
                                                                  BullMQ
                                                        webhooks · SMS · reports · imports
```

---

## The five rules

Everything else in this repo is a consequence of these.

1. **PostgreSQL is the transactional source of truth.** Redis and NATS carry state that can be
   rebuilt. Neither is ever authoritative.
2. **Modules own their data and their business rules.** Ownership is explicit and total.
3. **Cross-module communication is an explicit contract** — an injected service or an event.
   Never an accidental table join.
4. **Events describe facts; jobs do work.** NATS says what happened. BullMQ does the thing.
5. **Microservices are an extraction strategy, not a starting architecture.**

Each is recorded with its alternatives in [../ADR/](../ADR/).

## Why a modular monolith

Twenty microservices means twenty containers, twenty pipelines, twenty databases, and
distributed transactions inside a business that is fundamentally one transaction — a parcel
moves, and money moves with it, or something is wrong.

One deployable gives strong transactional boundaries, simple local development, one debugger,
cheap infrastructure, and easy refactoring. And because every module already owns its schema and
communicates only through contracts, extraction is a deployment change rather than a rewrite —
see [extraction.md](extraction.md).

The cost is discipline. Nothing stops a module from reaching into another module's tables. That
is why the boundary is _enforced_, not merely documented: one TypeORM connection per module
scoped to its own schema, plus a CI grep. See
[module-boundaries.md](module-boundaries.md#enforcement).

## Why three entrypoints

One codebase, three roles. Separating them is a deployment and scaling decision, not an
architectural one.

| Entrypoint     | Does                                         | Scales with  |
| -------------- | -------------------------------------------- | ------------ |
| `main.ts`      | Serves HTTP, validates, dispatches use cases | Request rate |
| `worker.ts`    | Runs BullMQ workers, consumes NATS events    | Work volume  |
| `publisher.ts` | Drains the outbox to NATS                    | Event rate   |

Running only `main.ts` is a perfectly valid small deployment. All three import the same domain
modules — never duplicate a module per process.

## Module layout

Every module is a flat NestJS feature module — models, services, controllers side by side,
Django-app style — with exactly one exception:

```
shipment/
  shipment.module.ts    wires providers to the connections they own
  shipment.service.ts   @Injectable(), owns the transaction boundary
  shipment.controller.ts thin: validate → one service call → return
  shipment.entity.ts    TypeORM row shape for the module's schema
  shipment.repository.ts joins the caller's transaction, opens none of its own
  rules/                framework-free pure logic — state machines, transitions,
                        domain errors. Checker-enforced, never decorated.
```

One-way knowledge: the controller knows the service; the service and the entity both know the
rules; the rules know nothing. Files matching `rules/` import no framework — no `@nestjs/*`, no
`typeorm`, no `class-validator` decorators, no BullMQ, no Nest DI. Domain errors are plain `Error`
subclasses.

See [module-boundaries.md](module-boundaries.md) for the full contract, and
[../domains/](../domains/) for what each of the eighteen modules owns.

## Consistency model

Two different guarantees, deliberately applied to different things.

**Strong, transactional** — shipment status transitions, COD collection, settlement, permission
changes. If these are wrong, money or physical custody is wrong.

**Eventual, projected** — analytics, notifications, search, dashboards, webhook delivery. These
are derived views that must never slow down or fail a transaction.

The test: if a projection is stale by two seconds, is that a bug? For analytics, no. For a
shipment's status, yes.

## Request lifecycle

```
HTTP request
  → guard: auth, permission, rate limit
  → controller: validate DTO          (transport)
  → application service:              (owns the transaction)
        begin transaction
        load aggregate, validate transition   (domain)
        persist                          (infrastructure)
        append tracking event             (owning module)
        insert outbox row                (system)
      commit
  → map domain errors to the §87 envelope
```

The transaction boundary lives in the application service. Repositories accept an optional
`EntityManager` so they join the caller's transaction and never open their own.

## Stack

Pinned 2026-10-02, with rationale per choice in [../ADR/](../ADR/).

| Concern           | Choice                                                |
| ----------------- | ----------------------------------------------------- |
| Runtime           | Node 22+, pnpm workspaces, turbo                      |
| Backend           | NestJS 12, TypeScript 7                               |
| Persistence       | TypeORM 1.1, PostgreSQL + PostGIS, migrations only    |
| Events            | NATS JetStream                                        |
| Work              | BullMQ on Redis                                       |
| Cache / ephemeral | Redis                                                 |
| API contract      | Swagger → OpenAPI → generated client                  |
| Observability     | OpenTelemetry, Prometheus, Grafana, pino              |
| Web               | React 19, TanStack Router/Query/Table, Vite, Tailwind |
| Other             | Expo (rider), Electron (desktop), Astro 7 (site)      |

> TypeORM is at 1.x. Most NestJS examples and tutorials target 0.3.x. Read the installed
> `.d.ts` before trusting an example, and note gaps when found.

## Where to read next

| Question                         | File                                         |
| -------------------------------- | -------------------------------------------- |
| What may touch what?             | [module-boundaries.md](module-boundaries.md) |
| What are the schemas and rules?  | [database.md](database.md)                   |
| What happens on a state change?  | [eventing.md](eventing.md)                   |
| What are the legal transitions?  | [state-machines.md](state-machines.md)       |
| How is money represented?        | [money-and-ledger.md](money-and-ledger.md)   |
| How do we call payment/SMS/mail? | [provider-adapters.md](provider-adapters.md) |
| How does this become services?   | [extraction.md](extraction.md)               |
| What does each domain own?       | [../domains/_index.md](../domains/_index.md) |
