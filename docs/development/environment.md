# Environment

Local setup, from a clean clone to a running system.

## Two ways to run it

| Command                      | What runs                            | Use it for                                   |
| ---------------------------- | ------------------------------------ | -------------------------------------------- |
| `pnpm demo:up`               | everything, in containers            | seeing the product, demoing it, a first look |
| `pnpm infra:up` + `pnpm dev` | infra in containers, app on the host | editing source with fast reload              |

Both end at the same URLs, because both implement the same architecture: three backend processes,
each answering `/api` for the browser on its own origin. Pick by where your editor points, not by
which one works — they are both supported, and the difference is only where the code lives.

## Requirements

|        |                                         |
| ------ | --------------------------------------- |
| Node   | 24+ (`node --version`)                  |
| pnpm   | 11+ (`corepack enable`)                 |
| Docker | with Compose v2 — Postgres, Redis, NATS |

No global installs beyond those three. Everything else is a workspace dependency.

## Run it in containers

```bash
git clone <repo> && cd zipzap
cp .env.example .env          # every value has a working default; edit none of them
pnpm demo:up                  # builds four images on the first run, ~4 minutes
```

That is the whole path. `demo:up` brings up Postgres, Redis, NATS, runs the migrations and the
seed as a one-shot container, then starts the three backend processes and two web surfaces. Read
the demo login out of the seed's output — it generates one and prints it once, and there is no way
to recover it afterwards because only a hash is stored:

```bash
docker compose --env-file .env -f infra/compose/docker-compose.yml --profile app logs migrate
```

| Surface                              | URL                             |
| ------------------------------------ | ------------------------------- |
| Merchant console                     | http://localhost:5173           |
| Public tracking                      | http://localhost:5174           |
| API                                  | http://localhost:3000           |
| Swagger (`APP_NODE_ENV=development`) | http://localhost:3000/docs      |
| Contract JSON                        | http://localhost:3000/docs-json |
| Health                               | http://localhost:3000/healthz   |
| Readiness                            | http://localhost:3000/readyz    |
| Worker metrics                       | http://localhost:9092/metrics   |
| Publisher metrics                    | http://localhost:9093/metrics   |

`pnpm demo:logs` follows everything. `pnpm demo:down` stops it; add `-v` to drop the database too.

The first `demo:up` builds two Dockerfiles that are worth reading once, because the second one
explains most of the rest:

- `infra/docker/backend.Dockerfile` — one image, **no `CMD`**, `ENTRYPOINT ["node"]`. The three
  processes differ only in which file they are handed, which is the "one codebase, three
  entrypoints" claim made concrete rather than aspirational.
- `infra/docker/web.Dockerfile` — one Dockerfile for every browser surface, selected by
  `--build-arg APP=…`. It ships `infra/docker/web-host.mjs`, a dependency-free Node host that owns
  both the HTTP socket and the `/api` proxy, because these apps are server-rendered and the proxy
  is what makes the session cookie first-party.

### Why the containers do not need your `.env`

Everything in the `app` profile addresses its dependencies by service name — `postgres:5432`,
`redis:6379`, `nats:4222` — so the wiring is the same on every machine. `.env` only moves the
ports on _your_ host. That is the difference between `demo:up` working the first time and working
after you edit four URLs to match a laptop that already had Postgres running.

One thing in the compose file is not cosmetic: the two web ports are published as
`${MERCHANT_WEB_PORT:-5173}:${MERCHANT_WEB_PORT:-5173}`. The same number on both sides is
load-bearing, because the merchant console's server-side guard resolves its relative `/api` base
URL against the origin the browser used and fetches it back — the app asks _itself_ for `/api` on
the port it is published on. Changing one half without the other produces a login that succeeds
and then forgets you.

## Run it on the host

Use this when you are editing source. It is the same system; only the process boundary moves.

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
because it is a debugger rather than an interface. The containers run `NODE_ENV=production`, so
`/docs` is absent there by the same rule — `APP_NODE_ENV=development` in `.env` brings it back.

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

In containers the same three processes are three compose services over one image, and the only
thing that differs between them is the path handed to `node`:

```yaml
api: { command: ['apps/backend/dist/main.js'] }
worker: { command: ['apps/backend/dist/worker.js'] }
publisher: { command: ['apps/backend/dist/publisher.js'] }
```

That is why the image has `ENTRYPOINT ["node"]` and no `CMD`. A baked-in default would make the
other two unreachable without `--entrypoint`, and would quietly start an API in a container that
was supposed to be the publisher.

## Database

```bash
pnpm db:migrate               # apply migrations
pnpm db:revert                # roll back the last one
pnpm db:seed                  # demo data
pnpm --filter @zipzap/backend db:generate -- src/modules/<m>/infrastructure
```

Migrations are code. Never edit an applied one; write a new one. `synchronize` is `false`
permanently — see [../architecture/database.md](../architecture/database.md).

Under `demo:up` both of the first two run as a one-shot `migrate` service that every other
container waits on with `condition: service_completed_successfully`. Not a sleep and not a retry
loop: that is the only condition that means the schema is actually at the version the image
expects. Migrations are idempotent, so a second `demo:up` reports "already up to date"; the seed
appends a fresh credential each time rather than colliding with the last one.

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

pnpm infra:up                  # postgres · redis · nats, only
pnpm demo:up                   # + build the images, migrate, seed, start everything
pnpm demo:logs                 # follow every container in the app profile
pnpm demo:down                 # stop it (-v also drops the database)
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

**Port in use** — `lsof -i :3000`, then change `PORT` in `.env`. For the container stack, change
`API_PORT` instead: `pnpm demo:down && pnpm demo:up`.

**Web port in use (5173/5174)** — the container stack publishes on the Vite dev ports on purpose,
so there is one URL per surface and both stacks cannot quietly claim it. Either stop `pnpm dev`, or
move the container: `MERCHANT_WEB_PORT=4273 pnpm demo:up` — both halves of the port mapping move
together, so the app can still reach itself.

**Login succeeds, then the console bounces you to /login** — the SSR guard could not read a
principal. In a container that is almost always a port mapping that was changed on one side only;
`docker compose logs merchant-web` shows the `/api -> …` line the host booted with.

**"Migration fails halfway"** — Postgres DDL is transactional. `pnpm db:revert` then fix and
re-run. If it is genuinely wedged, that is a bug in the migration, not a reason to
`synchronize: true`.

**"Cannot find module @zipzap/ui"** — `pnpm install`. Workspace links are symlinks; a partial
install leaves them dangling. Inside an image this cannot happen: `pnpm deploy` emits a hoisted
tree, so there is no symlink left pointing at a workspace that is not there.

**`docker compose config` fails on a dependency cycle** — a service ended up depending on itself.
`migrate` is the one to check: it merges everything `api` does and then has to drop `migrate` from
its own `depends_on`, or Compose resolves it as a cycle.

**TypeORM metadata error after adding an entity** — the entity is not in its module's `entities`
array. Each module registers only its own.

**Port 4222 busy (NATS)** — a stray container from a previous run. `docker compose -f
infra/compose/docker-compose.yml down && pnpm infra:up`.

---

Related: [workflow.md](workflow.md) · [../testing/strategy.md](../testing/strategy.md) ·
[../../AGENTS.md](../../AGENTS.md)
