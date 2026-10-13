# AGENTS.md

## What this is

ZipZap — a logistics operating system for e-commerce merchants, riders, hubs and delivery
operations. It models a real courier business end to end: order → pickup →
origin hub → line-haul → destination hub → last-mile → COD → settlement.

**Modular monolith.** One deployable, many internal domains. Microservices are an extraction
strategy, never the starting point.

## Read before you touch anything

| You are changing        | Read first                                    |
| ----------------------- | --------------------------------------------- |
| anything                | `docs/architecture/overview.md`               |
| a domain's rules        | `docs/domains/<module>.md`                    |
| a table / schema        | `docs/architecture/database.md`               |
| setup / commands        | `docs/development/environment.md`             |
| an architectural choice | `docs/ADR/` — if it isn't recorded, record it |

`prompt.txt` is the raw product brainstorm. It is gitignored and **not** the source of truth.
The distilled docs are.

## Stack

Pinned 2026-10-02, all versions verified against the npm registry on that date.

```
Runtime     Node 24+ · pnpm 11 workspaces · turbo 2.11
Backend     NestJS 12 · TypeORM 1.1 · PostgreSQL 18 + PostGIS · Swagger/OpenAPI
Language    TypeScript 6.0 (NOT 7 — see the version traps below)
Async       NATS JetStream (events) · BullMQ (work) · Redis (cache, rate limit, idempotency)
Obs.        OpenTelemetry · Prometheus · Grafana · pino
Web         React 19 · TanStack Router/Query/Table · Vite · Tailwind
Other       Expo / React Native (rider) · Electron (desktop) · Astro 7 (site + docs)
Testing     Vitest 5 (*.spec.ts colocal, node env) · @nestjs/testing DI · Testcontainers (integration)
```

### Version traps — all four were hit, all four will bite again

- **TypeScript 7 ships `tsc` only.** It has no programmatic compiler API, so `@nestjs/cli`
  cannot build. The API returns in 7.1. Stay on TypeScript 6 until that lands, then re-check
  before upgrading.
- **TypeORM is 1.x, not 0.3.x.** `NamingStrategy` was renamed `NamingStrategyInterface`, and
  `columnName()` gained a third `embeddedPrefixes` argument. Most tutorials and AI priors
  describe 0.3.x. Read the installed `.d.ts` before trusting an example.
- **`pg`'s `getTypeParser` override is global.** Returning a parser unconditionally replaces
  _every_ type parser — it broke `SELECT version()`. Only override the OID you mean
  (`src/database/pg-types.ts`).
- **esbuild (Vitest's transformer) cannot infer constructor DI.** Bare params resolve
  `undefined` under Vitest while working under `tsc`, because the Nest decorator metadata is
  never emitted. Fix it once, in production code: explicit `@Inject()` on every constructor
  param. If a service works in `pnpm dev` and `undefined`s in `pnpm test`, this is why.

## Layout

```
apps/backend                    @zipzap/backend     3 entrypoints from one codebase
apps/frontends/*                @zipzap/*           one package per surface
apps/mobile-rider               @zipzap/rider       Expo
apps/desktop                    @zipzap/desktop     Electron + React
apps/site                       @zipzap/site        Astro: landing + docs
packages/ui                     @zipzap/ui          shared React components
packages/api-client             @zipzap/api-client  GENERATED from OpenAPI
packages/{tsconfig,eslint,tailwind}-config
docs/                           product · architecture · domains · api
                                operations · development · testing · ADR
infra/compose                   postgres · redis · nats · prometheus · grafana
infra/fakes                    @zipzap/fakes       local provider stand-ins (never deployed)
```

Three backend entrypoints, one module graph (`src/main.ts` API · `src/worker.ts` BullMQ +
NATS consumers · `src/publisher.ts` outbox publisher). Never duplicate a domain module per
process — import it.

## Non-negotiable rules

1. **PostgreSQL is the only source of truth.** Redis and NATS are never authoritative.
2. **A module owns its schema.** No module may read or write another module's tables — no
   JOINs, no foreign repositories, no raw SQL crossing a schema boundary. Cross-module =
   injected service (sync) or event (async).
   Enforced by one `TypeOrmModule.forRoot({ schema })` per module + the boundary
   checker, which runs in `pnpm verify` and in `.githooks/pre-commit`.
3. **Pure rules import nothing from the framework.** Files matching `rules/` are plain
   TypeScript: no `@nestjs/*`, no `typeorm`, no `class-validator` decorators, no BullMQ,
   no Nest DI. Domain errors are plain `Error` subclasses. Enforced by the checker on the
   directory name, not on promises.
4. **Money is integer minor units + currency.** `125050` poisha. Never `1250.50`. Never float,
   anywhere, including tests. Columns are `bigint`. Arithmetic is integers only.
5. **`synchronize: false` permanently.** Every schema change is a reviewed migration. Never
   edit a migration that has been applied anywhere.
6. **State transitions are validated.** A status column is never `UPDATE`d directly. It changes
   only through a domain transition that validates the current state.
7. **Every mutation writes an outbox row in the same transaction.** The outbox publisher is the
   only thing that publishes to NATS. NATS says _what happened_; BullMQ _does the work_.
8. **Append-only where it is history.** Tracking events, ledger entries, audit rows, webhook
   delivery logs are never updated or deleted. Corrections are new compensating rows.
9. **`Idempotency-Key` is mandatory** on: shipment create, bulk import, COD collect, delivery
   confirm, settlement approve, rider offline sync. The server must reject duplicates.
10. **Never log**: password, API secret, token, webhook signing secret, full payment credential.
11. **A provider's wire format never leaves `<module>/provider/`.** No `'status_code'` or
    `'1250.50'` in a rules, service, or controller file. See docs/architecture/provider-adapters.md.

## Conventions

- **Module shape**: flat NestJS feature modules. Each `src/modules/<name>/` mixes
  `<name>.module.ts`, `<name>.service.ts`, `<name>.controller.ts`, `<name>.entity.ts`,
  `<name>.repository.ts`. One exception kept from the layered sketch: a `rules/` subdir holds
  the framework-free pure logic — entities-as-values, state machines, domain errors — and the
  checker enforces zero framework imports there.
  - The **service** (Nest `@Injectable()`) owns the transaction boundary.
  - The **controller** is thin: validate → one service call → return.
  - **Explicit `@Inject()` on every constructor param.** esbuild (Vitest's transformer) cannot
    emit decorator metadata, so bare params resolve `undefined` under Vitest while working under
    `tsc`. Nest's own runtime survives either; the tests do not.
- **Transactions**: the application service calls `manager.transaction()`. Repositories accept
  an optional `EntityManager` so they join the caller's transaction. A repository must never
  open its own transaction.
- **CQRS is logical**: separate command and query services, one database. No read replicas.
- **Errors**: domain errors are mapped once, in a single exception filter, to the §87 envelope.
  Controllers never hand-build error responses.
- **Naming**: columns are `snake_case` via the shared naming strategy — do not hand-name columns.
  Entities `PascalCase`, fields `camelCase`, events `PastTense` (`ShipmentDelivered`).
- **OpenAPI is generated** from controller decorators. `packages/api-client` is generated from
  it. Hand-editing either is a bug.
- **`shots/` is the visual memory.** After any visible change (new screen, component variant,
  layout shift), capture fresh shots — Storybook story iframes and real web routes — into
  `shots/` with a short date-prefixed name. Check old ones in; they are the fastest way to see
  what the product looks like without booting the stack.

## Before you commit

```bash
pnpm verify        # boundaries:check && format:check && prove && typecheck && test
```

There is no CI in this repository, so this command and `.githooks/pre-commit` are the whole gate.
Install the hook once per clone with `pnpm hooks:install`; it runs the boundary checker in full and
Prettier on the staged files only.

There is no ESLint yet. `noUnusedLocals` and `noUnusedParameters` in `tsconfig.base.json`
cover the class of bug ESLint would catch here, and Prettier covers formatting. Add ESLint when
a rule cannot be expressed in those two — not before.

- New module → `docs/domains/<module>.md` + an ADR if it changed a boundary.
- New table or column → a migration + an update to `docs/architecture/database.md`.
- Touching money or a state machine → add a unit test. That is not optional.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
