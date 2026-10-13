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
| Spec JSON  | http://localhost:3000/docs-json     |
| Spec YAML  | http://localhost:3000/docs-yaml     |
| Health     | http://localhost:3000/healthz       |
| Prometheus | http://localhost:9090               |
| Grafana    | http://localhost:3001 (admin/admin) |

`pnpm infra:logs` follows all container logs. `pnpm infra:down` stops them.

`/docs-json` and `/docs-yaml` are served in every environment: they are the machine-readable
contract the generated client and CI are built from. The interactive `/docs` UI is development-only,
because it is a debugger rather than an interface.

### Web apps talk to the API through `/api` on their own origin

```bash
pnpm --filter @zipzap/merchant-web dev           # http://localhost:5173
pnpm --filter @zipzap/control-tower dev          # http://localhost:5174
pnpm --filter @zipzap/hub-console dev            # http://localhost:5175
```

Each app's dev server proxies `/api/*` to `API_ORIGIN` (default `http://localhost:3000`), so the
browser sees one origin. That is what makes `zipzap_session` a first-party cookie — a cross-origin
request cannot carry one without `SameSite=None`, which is a deprecated third-party cookie with no
CSRF protection. See
[../ADR/0016-http-only-sessions.md](../ADR/0016-http-only-sessions.md).

The proxy is not a plain forward: it also strips the `/api` prefix, rewrites `Origin` to the API's
own, and drops `sec-fetch-*`. Without those three the backend reads the request as cross-site and
rejects it with a 401 that looks exactly like a wrong password.

`VITE_API_URL` is gone. There is no API URL for the browser to know.

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

Unit tests run under Vitest as `*.spec.ts` colocated with source:

```bash
pnpm --filter @zipzap/backend test          # vitest run, once
pnpm --filter @zipzap/backend test:watch    # watch mode
```

Pure `rules/` files need no container. Services instantiate through `@nestjs/testing` with
`useMocker()` — every constructor param carries an explicit `@Inject()` because esbuild cannot
emit the decorator metadata `tsc` would, and bare params resolve `undefined` under test.

## Adding a module

Flat, Django-style. No subdirs except `rules/`:

```bash
mkdir apps/backend/src/modules/<name>/rules
```

- [ ] `<name>.entity.ts` owns the TypeORM shape for the module's schema
- [ ] `<name>.service.ts` is `@Injectable()` and owns the transaction boundary
- [ ] `rules/` imports nothing from the framework
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
