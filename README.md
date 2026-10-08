# ZipZap

**A logistics operating system for e-commerce fulfillment and last-mile delivery.**

Not a parcel tracker. ZipZap is the internal operating platform of a courier business —
merchant onboarding through COD reconciliation to settlement — in one deployable modular
monolith. Built for Bangladesh first; the courier vertical is the first, not the only, case.

```
Merchant ─► Shipment ─► Pickup ─► Origin hub ─► Line-haul ─► Destination hub
                                                                    │
     Settlement ◄── COD ◄── Delivered ◄── Last mile ◄── Out for delivery
```

## Status

**Founding product — foundation stage.** Architecture is decided and documented; the shipment
vertical is not yet implemented. Phase progress:

| Phase | Scope                                                                  | State       |
| ----- | ---------------------------------------------------------------------- | ----------- |
| 0     | Foundation — repo, docs, ADRs, infra, CI                               | in progress |
| 1     | Identity · merchant · shipment · tracking                              | next        |
| 2     | Pickup · rider · hub · manifest · delivery · returns                   | —           |
| 3     | COD · ledger · settlement                                              | —           |
| 4     | Public API · webhooks · bulk import · notifications · risk             | —           |
| 5     | PostGIS · routing · serviceability · rider optimization · offline sync | —           |
| 6     | Control tower · analytics · simulation · load testing                  | —           |

## Stack

NestJS 12 · TypeORM 1.1 · PostgreSQL + PostGIS · Redis · NATS JetStream · BullMQ ·
React 19 · TanStack Router/Query/Table · Expo · Electron · Astro 7 ·
OpenTelemetry · pnpm + turbo

Pinned versions and the reasoning behind them: [`docs/architecture/overview.md`](docs/architecture/overview.md).

## Quickstart

```bash
pnpm install
docker compose -f infra/compose/docker-compose.yml up -d   # postgres redis nats
pnpm --filter @zipzap/backend db:migrate
pnpm --filter @zipzap/backend dev                          # API on :3000
pnpm dev                                                  # everything, via turbo
```

API docs at `http://localhost:3000/docs` · Grafana at `http://localhost:3001`.

> Commands are defined by the scripts added in the scaffold step; this section is the
> contract they are being written to satisfy.

## Layout

```
apps/backend          NestJS — one dir per domain module, 3 entrypoints (api/worker/publisher)
apps/frontends/*      merchant-web · customer-tracking · control-tower · hub-console · admin-console
apps/mobile-rider     Expo rider app (offline-capable)
apps/desktop          Electron wrapper for the ops console
apps/site             Astro — landing page + developer docs
packages/ui           shared React components
packages/api-client   generated from the backend OpenAPI spec
docs/                 product · architecture · domains · api · operations · development · ADR
infra/compose         local postgres · redis · nats · prometheus · grafana
```

## Principles

Five rules, in priority order. Everything else is negotiable; these are not.

1. PostgreSQL is the transactional source of truth.
2. Modules own their data and their business rules.
3. Cross-module communication is an explicit contract — never an accidental table join.
4. Events describe facts; jobs do work.
5. Microservices are an extraction strategy, not a starting architecture.

## Documentation

|              |                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------- |
| Product      | [`docs/product/`](docs/product/) — vision, personas, roadmap                                 |
| Architecture | [`docs/architecture/overview.md`](docs/architecture/overview.md) — modules, boundaries, flow |
| Domains      | [`docs/domains/`](docs/domains/) — one file per business domain                              |
| ADRs         | [`docs/ADR/`](docs/ADR/) — every architectural decision, with its alternatives               |
| API          | [`docs/api/`](docs/api/) — authentication, versioning, errors, webhooks                      |
| Development  | [`docs/development/environment.md`](docs/development/environment.md) — setup and commands    |
| Testing      | [`docs/testing/`](docs/testing/) — strategy, fixtures, conventions                           |
| Operations   | [`docs/operations/`](docs/operations/) — deployment, observability, runbooks                 |

Working agreements for both humans and agents: [`AGENTS.md`](AGENTS.md).

## License

MIT — see [LICENSE](LICENSE).
