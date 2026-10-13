# ADR-0017: Integration tests wire their own graph, through one harness

**Status** accepted · 2026-10-12

## Context

The integration suites under `apps/backend/test/integration/` import from `dist/`, not `src/`.
Two reasons, both load-bearing:

1. `node:test` cannot load decorators, so an `@Injectable()` class is unloadable from source.
2. A test that exercises the compiled artifact is testing what production actually runs.

The consequence nobody planned for is that these tests also **cannot use Nest's DI container**.
There is no `Test.createTestingModule` in any of them. Every service is constructed by hand in a
`before` hook, from its real dependencies, against real Postgres connections:

```ts
new CreateShipmentService(
  shipmentDb,
  new ShipmentRepository(),
  new AppendTrackingEventService(),
  new PricingService(pricingDb, new PricingRepository()), // <-- and this
  new EnsureCodRecordService(codDb),
  new NetworkService(networkDb),
);
```

Hand-wiring buys real things a mocked container cannot give you: that a transaction actually rolls
back, that a unique constraint actually resolves a concurrent race, that a CHECK constraint
actually rejects an append-only UPDATE. Those are the assertions worth having, so the trade was
worth taking.

The cost is that **adding a constructor parameter silently breaks every suite that builds that
service by hand.** TypeScript does not catch it — the emitted `.d.ts` makes the extra parameter
optional — and the unit suite does not touch the path, so `pnpm test` stays green.

That is not hypothetical. Three separate drifts accumulated, each invisible until the integration
suite was actually run:

| Dependency added later                                  | Suites still passing too few args | Failure at runtime                                           |
| ------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| `MERCHANT_PLAN_LOOKUP` on `PricingService`              | 4                                 | `Cannot read properties of undefined (reading 'planFor')`    |
| `HubRepository` + `SHIPMENT_LOOKUP` on `HubScanService` | 2                                 | `Cannot read properties of undefined (reading 'findByCode')` |
| `COD_LOOKUP` on `CreateSettlementService`               | 1                                 | settlement created with nothing blocking it                  |

`pnpm test:integration` was also **not runnable at all** — CI invokes it, but no package defined
the task, so turbo refused to dispatch it. Two of the seventeen integration suites had never been
executed by anyone.

## Decision

**One harness owns the wiring: `test/integration/harness.ts`.**

Every service that more than one suite needs is built there, once, by a named function. A suite
imports `buildPricingService()`, not a constructor call it wrote itself.

```ts
const pricing = await buildPricingService();
service = new CreateShipmentService(…, pricing.service, …);
```

Three properties, in priority order:

1. **A signature change becomes one edit with N compile errors**, instead of N silent runtime
   failures. The dependency list is written in one place, so `PricingService` gaining a fourth
   parameter breaks the harness at compile time and the argument is unmissable.
2. **The wiring is still real.** No container, no mocks. The harness calls the same constructors
   the module graph calls, against the same module-scoped `DataSource`s. `compile()` was never an
   option anyway — the whole point is to exercise real transactions.
3. **Cross-module contracts get named stubs where a stub is honest.** `StubPlanLookup` answers
   `'standard'` for an unknown merchant, mirroring the production contract exactly, because the
   alternative is a second `merchant` connection every suite has to open and close.

Two related fixes came with it, both about a build that lies:

- **`scripts/build.mjs` verifies its own output.** `nest build` exited 0 while producing an empty
  `dist/`, when a root-owned leftover from an earlier root-run build made `deleteOutDir` fail
  silently. A green build that produces nothing, followed by sixteen suites reporting a missing
  artifact, is the worst available failure mode. The wrapper builds, checks the three entrypoints
  exist, and exits non-zero with the actual remedy if not.
- **`turbo.json` declares `test:integration` with `dependsOn: ["build"]`** — its _own_ build, not
  `^build`. Without it turbo restores a cached `dist/` — one recorded while it was empty — over a
  good build, and every suite fails on `Cannot find module 'dist/…'`. `cache: false`, because
  these tests bind ports and talk to live infrastructure; a cached pass is not evidence.

## Consequences

### Positive

- A constructor change can no longer break integration tests silently.
- The integration suite runs, and passes: **106 assertions** across 16 files.
- `pnpm test:integration` exists as a task, so the CI step that invokes it can go green.
- Cross-module lookups have one obvious test seam (`StubPlanLookup`, `NoBlockers`).
- Two latent production bugs surfaced by running the suite at all — the simulator could not
  deliver a parcel without proof of delivery, which had been broken since that rule landed.

### Negative

- One more file to read before adding a suite. The harness is only worth it for services more than
  one suite constructs; a single-suite service stays inline.
- A stub is a stub. `StubPlanLookup` returning `'standard'` is faithful today and could drift from
  the real lookup. It is documented at the definition and pinned by the production contract's own
  tests.
- `scripts/build.mjs` is a wrapper around a CLI rather than a direct invocation, so a
  `@nestjs/cli` major bump needs a look at it.

## Alternatives considered

**Use `Test.createTestingModule` with overridden providers.** Rejected: it gives up the real
connections these tests exist to use, and reintroduces the mocking they were written to avoid.

**Delete the integration suite.** Rejected: the assertions that motivated it — rollback, race
resolution, append-only enforcement — are the ones that caught this drift in the first place.

**Add a runtime arity check** (`assert(argc >= constructor.length)`) to each suite. Rejected as
the primary mechanism: it catches the bug at runtime rather than at compile time, which is the
same failure mode with extra steps. The harness achieves the compile-time check structurally.
