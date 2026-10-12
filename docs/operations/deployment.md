# Deployment

## Local

Two supported shapes. They run the same three processes and answer the same URLs.

```bash
pnpm demo:up                   # everything in containers — what a reviewer or a CI smoke test uses
```

```bash
pnpm infra:up                  # postgres+postgis · redis · nats · prometheus · grafana
pnpm dev                       # api + worker + publisher on the host
```

The container stack is not a second deployment target with its own rules. It is the same rules with
the process boundary moved, which is why `infra/compose/docker-compose.yml` describes the backend
services as one image and three `command:` values rather than three definitions. What it adds is
a release step — a one-shot `migrate` service that must exit 0 before the API starts — because a
container stack has nowhere for a human to notice a failed migration and carry on.

| Compose service     | Command                               | Host port           |
| ------------------- | ------------------------------------- | ------------------- |
| `api`               | `node apps/backend/dist/main.js`      | 3000                |
| `worker`            | `node apps/backend/dist/worker.js`    | 9092 (metrics only) |
| `publisher`         | `node apps/backend/dist/publisher.js` | 9093 (metrics only) |
| `merchant-web`      | `infra/docker/web-host.mjs`           | 5173                |
| `customer-tracking` | `infra/docker/web-host.mjs`           | 5174                |

Every host port is overridable in `.env`. The two web ports are published on both sides of the
mapping on purpose — see [../development/environment.md](../development/environment.md).

## Production — initial

```
Cloud / VPS
    │
    ├── Reverse proxy (TLS termination)
    ├── ZipZap API          :3000
    ├── ZipZap Worker       :3000
    ├── ZipZap Publisher    :3000
    ├── PostgreSQL + PostGIS
    ├── Redis
    └── NATS JetStream
```

One host. Reverse proxy in front, three processes behind it. Containerised.

Three processes, not three machines — they scale independently when they need to, and nothing
requires it on day one. The publisher is the one that will scale first if outbox depth becomes a
problem, because it is the one doing the least.

## Process roles

| Process   | Entrypoint                       | Scales with  |
| --------- | -------------------------------- | ------------ |
| API       | `apps/backend/dist/main.js`      | request rate |
| Worker    | `apps/backend/dist/worker.js`    | job volume   |
| Publisher | `apps/backend/dist/publisher.js` | event rate   |

One codebase, one image, three commands. The image is the same for all three — a role is an
entrypoint, not a build.

Concretely, that is why `infra/docker/backend.Dockerfile` sets `ENTRYPOINT ["node"]` and no `CMD`:
the image cannot express a preference about which role it is, so the deployer's compose file or
`docker run` command is the only place the choice is made, and it is made in one line.

## Images

```
infra/docker/backend.Dockerfile     one image, three entrypoints, no CMD
infra/docker/web.Dockerfile         one image, --build-arg APP=<workspace package name>
infra/docker/web-host.mjs           the host both web images serve through
```

Two rules the build stages keep:

- **Context is the repository root.** A pnpm workspace installs from the root; a Dockerfile cannot
  see `infra/`. `.dockerignore` is what makes that affordable.
- **Production dependencies come from `pnpm deploy --prod`.** Not `pnpm install --prod` in the
  workspace, which leaves symlinks into a root `.pnpm` store that is not in the runtime image. The
  deploy step is slower and produces a tree that resolves on its own, which is the only thing that
  matters at 3am.

Both runtime stages run as the unprivileged `node` user that ships with the base image. Neither
writes to disk at runtime — `synchronize` is false forever — so root would buy nothing. The web
image consequently binds a port above 1024 and never needs a capability dropped.

## k3s — later, with a trigger

Not now. Single-VPS deployment stops being enough when one of these is true:

- sustained CPU or memory pressure that vertical scaling cannot relieve
- the database needs to leave the application host
- a deploy needs to not take the whole system down
- more than one person needs independent deploys

Each of those is a real reason. "Kubernetes is how we deploy now" is not, and adopting it early
buys operational surface with no operational problem to spend it on.

## Configuration

Environment variables only. No config file in the image.

Required:

```
DATABASE_URL
REDIS_URL
NATS_URL
NATS_STREAM
PORT
```

Required in production, absent in development:

```
SESSION_SECRET
API_SECRET_ENCRYPTION_KEY
```

Secrets come from the platform's secret store. **Never in the image, never in the repository,
never in an env file that is not gitignored.** Generate with `openssl rand -base64 48`.

## Migrations

Run once, as a release step, before the new version takes traffic:

```bash
pnpm db:migrate
```

Additive first: add the column, deploy the code that writes both, then remove the old column in
a later release. Migrations that are not backward-compatible with the currently running version
will roll back under you during a deploy, and there is no graceful way to handle that.

`synchronize: false` permanently. Not "usually false", not "false in production". Permanently.

In the local compose stack this is the `migrate` service, and every other backend container waits
on it with `depends_on: {migrate: {condition: service_completed_successfully}}`. That condition is
the point. `service_started` on a migration job is a race that usually loses; a `sleep` is a race
that usually wins, which is worse. And because the job must exit 0, a broken migration fails the
deploy instead of leaving three processes up against a schema they cannot read.

The image needs `apps/backend/scripts/` next to `dist/` for this to work: `dist/database/cli.js`
reaches back into `../../scripts/seed.mjs` for the seed, which reaches into `../dist` again for the
secret hasher. A runtime image that copies `dist/` alone can migrate and cannot seed.

## Rollback

Roll back code, not schema. A migration is forward-only by policy — a `down` that destroys data
is a worse accident than a failed deploy.

So a bad deploy rolls back to the previous image, and any migration it left behind is
backward-compatible by construction. Write them that way and rollback stops being a decision.

## Health checks

```
GET /healthz    liveness — the process is up
GET /readyz     readiness — Postgres reachable, can serve traffic
```

Liveness must not check Postgres. A database blip would otherwise restart every process
simultaneously, turning a recoverable degradation into a full outage.

Readiness may check Postgres. It should not check Redis or NATS — the system degrades without
both, and refusing traffic during a Redis outage is how a rate-limiter problem becomes an
availability problem.

Two different questions, so two different probes, and the images use them differently on purpose.

The backend image bakes in a `HEALTHCHECK` for `/healthz`, because a bare `docker run` of the API
should report its own health with nothing else configured. That check is **disabled** for the
worker and publisher in `docker compose`: they expose only `/metrics`
(`apps/backend/src/worker.ts`, `publisher.ts`), so the probe would fail those two containers
forever and `docker compose ps` would show a permanently unhealthy process that is working fine.

Compose then _overrides_ the API's probe with `/readyz`, because a startup gate is not a liveness
probe — it is asking "can this serve traffic yet", which is a different question, and the one that
actually answers "should the web tier start".

## TLS

Terminated at the reverse proxy. The application speaks plain HTTP inside the network boundary.
Do not terminate TLS twice.

## TLS and the session cookie, in a container

The session cookie is `HttpOnly; Secure; SameSite=Lax` (ADR-0016). `Secure` means the browser
refuses to store it over plain HTTP — which is why every web app here is a _tier_ rather than a
static bundle, and why the reverse proxy in front of a deployment is not optional decoration.
Terminate TLS there, forward to the app's port, and the cookie works as written.

The same reasoning is why the web tier never calls the API cross-origin. Each app proxies `/api`
on its own origin (Vite's `server.proxy` in development, `infra/docker/web-host.mjs` in an image),
which is what keeps the cookie first-party and avoids `SameSite=None` entirely. If a deployment
ever puts a console on a different origin from the API, that is the moment `SameSite=None`
becomes unavoidable, and it should be treated as a finding rather than a configuration step.

---

Related: [reliability.md](reliability.md) · [observability.md](observability.md) ·
[../development/environment.md](../development/environment.md)
