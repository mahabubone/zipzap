# Deployment

## Local

```bash
pnpm infra:up      # postgres+postgis · redis · nats · prometheus · grafana
pnpm dev
```

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

| Process   | Command           | Scales with  |
| --------- | ----------------- | ------------ |
| API       | `start:api`       | request rate |
| Worker    | `start:worker`    | job volume   |
| Publisher | `start:publisher` | event rate   |

One codebase, one image, three commands. The image is the same for all three — a role is an
entrypoint, not a build.

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

## TLS

Terminated at the reverse proxy. The application speaks plain HTTP inside the network boundary.
Do not terminate TLS twice.

---

Related: [reliability.md](reliability.md) · [observability.md](observability.md) ·
[../development/environment.md](../development/environment.md)
