# Environment

Local setup, from a clean clone to a running system.

## Requirements

|        |                                         |
| ------ | --------------------------------------- |
| Node   | 24+ (`node --version`)                  |
| pnpm   | 11+ (`corepack enable`)                 |
| Docker | with Compose v2 — Postgres, Redis, NATS |

No global installs beyond those three. Everything else is a workspace dependency.

## Setup

```bash
git clone <repo> && cd zipzap

corepack enable
pnpm install

cp .env.example .env          # adjust if your ports differ
pnpm infra:up                 # postgres · redis · nats
pnpm db:migrate
pnpm dev                      # turbo: api + worker + publisher
```

| Service    | URL                                 |
| ---------- | ----------------------------------- |
| API        | http://localhost:3000               |
| Swagger    | http://localhost:3000/docs          |
| Health     | http://localhost:3000/healthz       |
| Prometheus | http://localhost:9090               |
| Grafana    | http://localhost:3001 (admin/admin) |

`pnpm infra:logs` follows all container logs. `pnpm infra:down` stops them.

## Processes

One codebase, three roles:

```bash
pnpm --filter @zipzap/backend dev          # api + worker + publisher together
pnpm --filter @zipzap/backend start:api
pnpm --filter @zipzap/backend start:worker
pnpm --filter @zipzap/backend start:publisher
```

Running only `api` is a valid small deployment. Each entrypoint imports the same domain modules.

## Database

```bash
pnpm db:migrate               # apply migrations
pnpm db:revert                # roll back the last one
pnpm db:seed                  # demo data
pnpm --filter @zipzap/backend db:generate -- src/modules/<m>/infrastructure
```

Migrations are code. Never edit an applied one; write a new one. `synchronize` is `false`
permanently — see [../architecture/database.md](../architecture/database.md).

### Connect directly

```bash
psql postgresql://zipzap:zipzap@localhost:5432/zipzap
```

`\dn` lists the schemas, `\d shipment.shipments` describes one. Useful for confirming a module
only ever touched its own.

## Everyday commands

```bash
pnpm dev                       # everything, via turbo
pnpm build                     # build all workspaces
pnpm verify                    # format:check && typecheck && test
pnpm typecheck                 # tsc --noEmit, per workspace
pnpm test                      # unit tests (node:test, no framework)
pnpm format                    # prettier --write
```

There is no ESLint yet. `noUnusedLocals` and `noUnusedParameters` in `tsconfig.base.json` cover
the unused-variable class of bug for free, and Prettier covers formatting. Add ESLint when a
rule cannot be expressed in those two.

Unit tests use Node's built-in runner and run TypeScript directly:

```bash
node --experimental-transform-types --test "test/*.test.ts"
```

They can only reach framework-free code, because Node cannot load decorators. That is the
architecture working — `domain/` is exactly the part that should be testable without a
container.

## Adding a module

```bash
mkdir -p apps/backend/src/modules/<name>/{domain,application,infrastructure,transport}
```

- [ ] `domain/` imports nothing from the framework
- [ ] `infrastructure/` owns the TypeORM entities for the module's schema
- [ ] the module's TypeORM connection is scoped to that schema
- [ ] a migration exists; `synchronize` is still `false`
- [ ] `docs/domains/<name>.md` exists
- [ ] an ADR, if it changed a boundary
- [ ] events are `PastTense` and carry a version

## Troubleshooting

**Port in use** — `lsof -i :3000`, then change `PORT` in `.env`.

**Migration fails halfway** — Postgres DDL is transactional. `pnpm db:revert` then fix and
re-run. If it is genuinely wedged, that is a bug in the migration, not a reason to
`synchronize: true`.

**"Cannot find module @zipzap/ui"** — `pnpm install`. Workspace links are symlinks; a partial
install leaves them dangling.

**TypeORM metadata error after adding an entity** — the entity is not in its module's `entities`
array. Each module registers only its own.

**Port 4222 busy (NATS)** — a stray container from a previous run. `docker compose -f
infra/compose/docker-compose.yml down && pnpm infra:up`.

---

Related: [workflow.md](workflow.md) · [../testing/strategy.md](../testing/strategy.md) ·
[../../AGENTS.md](../../AGENTS.md)
