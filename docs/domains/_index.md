# Domains

Eighteen domains, each a NestJS module with its own schema. The list mirrors the module graph —
nothing here that is not a directory under `apps/backend/src/modules/`.

Each file states what the domain **owns**, its rules, and what it deliberately must **not** touch.

## The list

| Module                          | Schema         | Phase | Owns                                                 |
| ------------------------------- | -------------- | ----- | ---------------------------------------------------- |
| [identity](identity.md)         | `identity`     | 1     | users, sessions, credentials, roles, permissions     |
| [merchant](merchant.md)         | `merchant`     | 1     | merchants, contracts, credentials, webhooks          |
| [customer](customer.md)         | `customer`     | 1     | customers, phones, addresses                         |
| [shipment](shipment.md)         | `shipment`     | 1     | the central aggregate                                |
| [tracking](tracking.md)         | `tracking`     | 1     | immutable movement history, public read model        |
| [pricing](pricing.md)           | `pricing`      | 1     | rules, quotes, versions                              |
| [network](network.md)           | `network`      | 2     | zones, routes, manifests, trips, geo, serviceability |
| [pickup](pickup.md)             | `pickup`       | 2     | requests, batches, assignments                       |
| [rider](rider.md)               | `rider`        | 2     | riders, devices, availability, scoring               |
| [hub](hub.md)                   | `hub`          | 2     | hubs, staff, capacity, schedules                     |
| [delivery](delivery.md)         | `delivery`     | 2     | jobs, attempts, proof                                |
| [returns](returns.md)           | `returns`      | 2     | return requests and approvals                        |
| [cod](cod.md)                   | `cod`          | 3     | expected and collected cash                          |
| [finance](finance.md)           | `finance`      | 3     | ledger, balances, settlements                        |
| [notification](notification.md) | `notification` | 4     | templates, messages, delivery                        |
| [support](support.md)           | `support`      | 4     | tickets, messages, escalations                       |
| [warehouse](warehouse.md)       | `warehouse`    | later | bins, inventory, movements                           |
| [analytics](analytics.md)       | `analytics`    | 6     | projections only                                     |

## Cross-cutting

Not business domains, but required:

| Module   | Why                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `system` | owns `system.outbox_events`, `system.idempotency_keys`, `system.consumed_events`. The mechanism that makes module isolation possible. |
| `common` | framework-free primitives: `Money`, domain errors, the §87 envelope. No business rules.                                               |

## Reading order

For a new contributor: [shipment](shipment.md) → [tracking](tracking.md) → [merchant](merchant.md)
→ [identity](identity.md) → [pickup](pickup.md) → [delivery](delivery.md) → [cod](cod.md) →
[finance](finance.md).

Everything else on demand.

## Conventions

Every module is four layers, dependencies pointing one way:

```
transport/       controllers, DTOs, validation
application/     use cases — owns the transaction boundary
infrastructure/  TypeORM entities, repositories, adapters
domain/          entities, value objects, state machines — framework-free
```

A module reads nothing from another module's schema. See
[../architecture/module-boundaries.md](../architecture/module-boundaries.md).
