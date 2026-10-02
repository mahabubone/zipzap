# Fixtures and seed data

Test and demo data must be **deterministic**. Same seed, same network, every time.

---

## Seed

```bash
pnpm db:seed
```

Creates:

```
8 divisions · 64 districts · sample upazilas · sample hubs
sample merchants · riders · customers · shipments · routes
```

The administrative hierarchy is real Bangladesh geography. The hubs, merchants, riders, and
shipments are synthetic.

**This is not a claim about any courier's real network.** It is a plausible shape for
demonstrating the model. Never present seeded coverage as operational fact.

### Determinism

Seeded from a fixed PRNG seed. No `Math.random()`, no `Date.now()` for anything that lands in
the database — otherwise every run produces a different dataset, and no failing test can ever be
reproduced.

Timestamps are relative to a fixed reference instant and shifted by the seeder, not sampled.

## Fixtures

```
apps/backend/test/fixtures/
├── factories/        builder functions, one per domain
├── scenarios/        named end-to-end situations
├── reference/        fixed reference data — real geography, holidays, currencies
└── helpers/          money, dates, ids
```

### Factories over fixtures

A factory takes overrides:

```ts
const shipment = buildShipment({
  status: ShipmentStatus.OUT_FOR_DELIVERY,
  cod: money(125050),
});
```

A fixed fixture file is a snapshot that every test ends up mutating, and that stops being valid
the moment the domain changes. Factories make the interesting part of a test visible in the test.

### Money helper

```ts
money(1250.50)  →  { amountMinor: 125050, currency: 'BDT' }
```

Never write `1250.50` in a test file. A test containing a float teaches the wrong thing and
hides rounding bugs — which are exactly the bugs these tests exist to catch.

### Time

Inject a clock. `domain/` takes a `Clock`; the test supplies a fixed one.

Business rules around cutoff times, SLA windows, and holiday calendars are all time-dependent. A
test that runs at 23:59 local time and passes differently tomorrow is worse than no test, because
it looks green.

## Scenarios

Named, reusable situations:

```
merchant_verified        a verified merchant with a live credential
cod_mismatch            COD that will not reconcile
settlement_pending      a merchant with an approved, unpaid settlement
rider_offline_queue     a rider with unsynced offline commands
manifest_discrepancy    a manifest missing a shipment
```

Tests reference a scenario by name rather than rebuilding it. When the domain changes, the
scenario changes once.

## Isolation

Each integration test runs against a **fresh database** — Testcontainers with a new container or
a truncated schema set between tests.

Tests that share state pass in order and fail in parallel, and you find out in CI rather than
locally.

## Seeding volumes

```bash
pnpm db:seed -- --profile=demo     # small, for local dev and demos
pnpm db:seed -- --profile=load     # large, for load testing
```

| Profile | Merchants | Customers | Riders | Hubs | Shipments |
| ------- | --------- | --------- | ------ | ---- | --------- |
| `demo`  | 20        | 200       | 30     | 5    | 500       |
| `load`  | 100       | 1,000     | 100    | 20   | 10,000    |

The load profile then simulates pickups, sorting, transit, delivery, returns, COD, and
settlement — see [../operations/demo-scenarios.md](../operations/demo-scenarios.md).

Load fixtures exist to measure, not to demonstrate. A demo dataset that also implies scale is
two claims, one of which will be wrong.

---

Related: [strategy.md](strategy.md) · [../operations/demo-scenarios.md](../operations/demo-scenarios.md)
