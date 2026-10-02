# ADR-0003: TypeORM with migrations, never `synchronize`

**Status** accepted · 2026-10-02

## Context

Schema changes must be reviewed, ordered, and reversible. `synchronize: true` has silently
dropped columns in production deployments of countless projects, and it makes the schema on disk
diverge from the schema in version control — after which no environment is trustworthy and no
migration history exists.

TypeORM is at **1.x**. Most NestJS examples, tutorials, and prior knowledge describe 0.3.x.

## Decision

**TypeORM for data access. `synchronize: false` in every environment, permanently.**

Every schema change is a reviewed migration, generated then edited by hand:

```bash
pnpm --filter @zipzap/backend db:generate   # generate
pnpm db:migrate                              # apply
pnpm db:revert                               # roll back the last
```

Supporting decisions:

- **Migrations are code.** Committed, reviewed, ordered by timestamp.
- **Never edit an applied migration.** Write a new one.
- **No cross-schema foreign keys.** See
  [ADR-0002](0002-postgresql-schema-boundaries.md).
- **Explicit `@Column({ name })` is not used** — columns are `snake_case` via a shared naming
  strategy, so it is impossible to forget one.
- **`bigint` for money**, parsed explicitly so `pg` does not silently hand back a string.

## Consequences

### Positive

- The schema in version control is the schema everywhere.
- Migrations run in order, are reviewable, and are reversible.
- TypeORM entities, migrations, and Nest DI all speak the same TypeScript types.

### Negative

- **The 0.3.x → 1.x gap is real.** Existing examples may not apply. Read the installed `.d.ts`.
- Migrations are a second representation of the schema, and they can drift from the entities.
- TypeORM's change detection is imperfect; a "no changes detected" result is not proof of
  correctness. Review generated SQL.
- Npgsql returns `bigint` as a string by default; the parser must be explicit or money silently
  becomes a string.

## Alternatives considered

**SQL-first with sqlc** (the original spec). Rejected: excellent for explicit SQL and typed
queries, but it adds a codegen step and a second language (SQL) to every schema change, and
NestJS DI has no natural integration. TypeORM's cost is abstraction; sqlc's cost is a
non-TypeScript schema definition. For a TypeScript monorepo, the abstraction is the cheaper
surprise.

**Prisma.** Rejected: its migration engine is still young, `synchronize`-style drift is easy to
reintroduce, and its domain modelling is looser than entities plus explicit repositories.

**Knex / raw SQL with a query builder.** Rejected: no entities, no metadata for Swagger or DI, and
more hand-written SQL for the same result.

**`synchronize: true` in development.** Tempting, and the reason this ADR exists. It means the
local schema is not the migrated schema, so a migration that works locally can still fail in
production. The divergence is exactly the problem.
