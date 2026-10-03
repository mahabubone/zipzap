# Testing strategy

Four levels. Each exists because the level below cannot catch a class of bug.

| Level           | Scope                                                  | Needs infra | Runs on       |
| --------------- | ------------------------------------------------------ | ----------- | ------------- |
| **Unit**        | `*.rules.ts` + services via `@nestjs/testing` (Vitest) | no          | every commit  |
| **Integration** | repositories, transactions, outbox (live Postgres)     | yes         | every PR      |
| **API**         | HTTP → service → Postgres                              | yes         | every PR      |
| **E2E**         | the full shipment lifecycle                            | yes         | main, nightly |

The first three run in CI on every push. E2E runs on `main` and nightly because it is slow and
stateful — a suite that only runs nightly is a suite that is red when you are fixing something.

## Unit — pure rules plus services, Vitest

Two tiers, same runner (`*.spec.ts` colocated, node env):

- **Rules**: no container, no database, no DI. `*.rules.ts` imports no framework precisely so
  this is possible.
- **Services**: `Test.createTestingModule` with `useMocker()` auto-mocks repositories and
  collaborator services. This is the class the old runner could never run — instantiation of a
  decorated class. Constructor params use explicit `@Inject()` on every param because esbuild
  cannot emit the decorator metadata `tsc` would.

Covered exhaustively:

- **shipment transitions** — every `from` × `to` pair. Legal passes, everything else throws.
- **pricing** — determinism: same inputs + same version = same quote, always. Itemisation sums
  to the total. Version freezing.
- **COD** — partial collection, reconciliation mismatch, reversal on return.
- **settlement** — allocation sums exactly, with the remainder assigned by policy.
- **routing** — eligibility filtering, capacity, deterministic tie-break.
- **authorization** — every permission × role, and tenant scoping.
- **idempotency** — key reuse with the same and different bodies.

These are pure functions over enums and integers. They are fast, they are exhaustive, and they
catch the bugs that otherwise become financial disputes. The exhaustive transition test in
particular is the highest-value test in the repo.

Money is integer minor units in tests too. A test using `1250.50` teaches the wrong thing and
hides rounding bugs.

## Integration — real infrastructure

Real Postgres, real Redis, real NATS. Testcontainers, not mocks.

Testcontainers rather than mocking the database: the whole point of these tests is transaction
behaviour, the unique constraint doing the concurrency work, `SKIP LOCKED`, and schema
boundaries. A mock database cannot test any of that, and pretending otherwise produces tests that
pass while the system is broken.

Covered:

- a use case commits all of its writes, or none
- the outbox row is in the same transaction as the state change
- `FOR UPDATE` serialises two concurrent transitions
- the unique constraint on idempotency keys makes exactly one of two racing requests win
- a module's schema-scoped connection **cannot** see another module's tables
- `REVOKE UPDATE, DELETE` on append-only tables actually holds
- the publisher drains with `SKIP LOCKED` and a crash loses nothing

That last one is the test that proves the outbox is not decorative.

## API — HTTP through to Postgres

```
request → guard → controller → use case → Postgres → response
```

- auth, permission, and tenant scoping on every route
- error envelope shape and status for every domain error
- `Idempotency-Key` returns the _original response_, not a 409
- pagination is stable under concurrent inserts
- the public tracking endpoint exposes nothing private
- OpenAPI matches reality

## E2E — the flagship stories

Two scenarios, automated, both in [`../operations/demo-scenarios.md`](../operations/demo-scenarios.md):

**Happy path** — merchant registers, is verified, creates a shipment, pricing is calculated,
pickup requested, rider assigned, pickup accepted and scanned, arrival at origin hub, dispatch,
arrival at destination hub, delivery job created, rider out for delivery, delivered, COD
collected, COD reconciled, settlement generated, webhook delivered, analytics updated.

**Failure path** — delivery fails, retry scheduled, second attempt fails, return initiated, return
moves through hub, merchant receives it, financial adjustment generated.

The failure scenario is not a lesser test. It is the one that distinguishes a working system from
a CRUD demo, and it is the one that is always the first thing skipped when time is short.

## Reliability tests

Deliberately induced failures:

- Postgres unavailable → requests fail 503, nothing is acknowledged or lost
- Redis unavailable → rate limiting fails closed on writes, open on reads
- NATS unavailable → mutations keep succeeding, outbox accumulates
- publisher killed mid-drain → resumes, publishes each event exactly once
- worker killed mid-job → job retries, no duplicate effect
- webhook endpoint down → retries on the ladder, then a visible failed state
- rider reconnects after offline → duplicates rejected, every command applied once
- duplicate settlement request → one settlement

## What not to do

**Do not mock the database.** See above — the behaviour under test _is_ the database's.

**Do not assert on log output.** It makes tests fail on cosmetic changes and pass on real bugs.

**Do not write a test that cannot fail.** Delete it or fix it. A test asserting a function was
called, with no assertion on the result, is coverage theatre.

**Do not test private methods.** Test behaviour through the public surface; refactoring should
not require rewriting tests.

**Do not chase coverage percentage.** 100% coverage of `return 1` is not coverage. Cover the
branches that would cost money or a parcel if they broke.

---

Related: [fixtures.md](fixtures.md) · [../development/workflow.md](../development/workflow.md)
