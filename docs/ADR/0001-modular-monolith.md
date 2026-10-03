# ADR-0001: Modular monolith over microservices

**Status** accepted · 2026-10-02

## Context

ZipZap is a logistics system where a parcel moves and money moves with it, or something is wrong.
`delivery → cod → finance` is one transaction. The team is small, the domain is large, and the
product must be demonstrable and correct.

Splitting this into services up front means distributed transactions inside a business that is
fundamentally local, plus the operational cost of many deployables — before there is a single
shipment.

## Decision

**One deployable application. Many internal modules. Clear, enforced boundaries.**

```
apps/backend — one NestJS codebase
  ├── main.ts        API
  ├── worker.ts      BullMQ + NATS consumers
  ├── publisher.ts   outbox
  └── modules/<name> 18 domain modules, one Postgres schema each
```

Each module owns its schema and communicates only through injected services or events. See
[ADR-0002](0002-postgresql-schema-boundaries.md).

Microservices are an **extraction strategy**, available when a module earns it. See
[ADR-0014](0014-future-service-extraction.md).

## Consequences

### Positive

- **Strong transactional boundaries.** A delivery and its COD collection commit together.
- One deployable, one pipeline, one debugger, one local stack.
- Cheap to run — a VPS, not a cluster.
- Free refactoring inside a process, which a network boundary would make expensive.
- Fast local development: `pnpm dev`, no mesh to debug.

### Negative

- **The boundary needs enforcement.** Nothing prevents a cross-module table access. Mitigated by
  schema-scoped TypeORM connections, framework-free `rules/` files, and a CI grep.
- **One deployable means one blast radius.** A bad deploy affects every module. Mitigated by
  roll-forward-only migrations and staged rollout.
- **Scaling is coarse.** Tracking load and finance load contend for the same process. Mitigated
  by three entrypoints so hot roles scale independently.
- Resource contention between modules inside one process. Acceptable at this scale, and a
  reason to check it rather than assume it.

## Alternatives considered

**Microservices from the start.** Rejected: distributed transactions for a locally-transactional
domain, 20 pipelines before the first customer, and a debugging story that makes the actual
problem — getting the domain right — harder to see.

**A single module.** Rejected: eighteen domains in one folder with no boundaries is a monolith
without structure, and the rules would not exist.

**Layered monolith** (`domain/`, `application/` at the top level, shared by everyone). Rejected
as the primary structure: it produces one large `services/` directory that every module depends
on, which is the boundary problem wearing a different hat. Layering exists _inside_ each module,
never above them.

**Serverless functions.** Rejected: cold starts on the tracking path, no long-lived NATS
consumers, and a deployment model that fights BullMQ.
