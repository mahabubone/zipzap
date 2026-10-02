# Demo scenarios

The two stories the product is judged on, and the tooling that produces them without a physical
courier network.

---

## Scenario 1 — the flagship path

```
 1. Merchant registers
 2. Merchant is verified
 3. Merchant creates shipment
 4. Pricing is calculated
 5. Pickup is requested
 6. Rider is assigned
 7. Rider accepts pickup
 8. Rider scans shipment
 9. Shipment reaches origin hub
10. Hub scans shipment
11. Shipment is dispatched
12. Destination hub receives it
13. Delivery job is created
14. Rider receives assignment
15. Rider goes out for delivery
16. Customer receives shipment
17. Rider collects COD
18. Shipment becomes delivered
19. COD is reconciled
20. Settlement is generated
21. Merchant receives settlement
22. Tracking timeline updates
23. Webhook is delivered
24. Analytics projections update
```

**The same event must be visible in five places at once:**

```
Merchant Dashboard  ·  Operations Console  ·  Rider App  ·  Customer Tracking  ·  Financial Dashboard
```

That simultaneity is the actual demonstration. It shows one event, one immutable log, five
projections — and it is only visible if the module boundaries held.

Automated as an E2E test. See [../testing/strategy.md](../testing/strategy.md).

---

## Scenario 2 — the failure path

```
Customer refuses delivery
  → Delivery failed
  → Retry scheduled
  → Second failure
  → Return initiated
  → Return moves through hub
  → Merchant receives return
  → Financial adjustment generated
```

**This is the more valuable demo and the one most often cut.**

Scenario 1 proves the happy path works. Scenario 2 proves the system is _correct_ — that a
refused parcel, a partial cash collection, a reversal, and a compensating ledger entry all
compose without anyone intervening.

A courier platform that only works when everything goes right is a demo. One that handles a
refused delivery, a short collection, and a return while keeping the ledger balanced is a
product.

---

## Simulation engine

Advance a shipment's state without physical infrastructure.

```bash
pnpm --filter @zipzap/backend simulate shipment ZP-8F32A1 --scenario delivered
```

| Scenario                | What it does                                |
| ----------------------- | ------------------------------------------- |
| `delivered`             | full path to `DELIVERED` with COD collected |
| `failed-then-delivered` | fails once, retries, succeeds               |
| `customer-refused`      | fails permanently, return initiated         |
| `returned`              | return through hub to merchant              |
| `lost`                  | `LOST`, exception raised                    |
| `damaged`               | `DAMAGED`, exception raised                 |

The simulator goes through the **real state machine and the real outbox**. It does not write
statuses directly — that would make it a tool that lies about the system, and a simulator that
bypasses the state machine can demo a transition the product cannot actually perform.

---

## Sandbox

A merchant environment where the operations are simulated and nothing costs money. Same code,
simulated providers.

```
Sandbox merchant → create shipment → simulated rider → simulated hub
                 → simulated delivery → simulated COD
```

This is what makes the product demonstrable to anyone, at any time, without one physical hub.

---

## Seed data

```bash
pnpm db:seed -- --profile=demo
```

8 divisions · 64 districts · sample upazilas · hubs · merchants · riders · customers ·
shipments · routes. See [../testing/fixtures.md](../testing/fixtures.md).

The administrative hierarchy is real Bangladesh geography. The operations are synthetic.

**Never present seeded coverage as a real courier's operating network.** It is a plausible shape
for demonstrating the model, and that is a different claim.

---

## Load testing

```bash
pnpm db:seed -- --profile=load
pnpm --filter @zipzap/backend test:load
```

100 merchants · 1,000 customers · 100 riders · 20 hubs · 10,000 shipments, then simulated
pickup, sorting, transit, delivery, returns, COD, and settlement.

Measure: RPS · latency p50/p95/p99 · DB utilisation · queue lag · event processing rate.

Compare against [performance.md](performance.md). Those numbers are hypotheses until this runs.

---

## Reviewer checklist

A new engineer should be able to answer, from the docs and a seeded environment:

- [ ] What problem does ZipZap solve?
- [ ] How does a shipment move, and where does that logic live?
- [ ] How does COD money stay correct?
- [ ] What happens on a duplicate request?
- [ ] How does an outage degrade instead of corrupting?
- [ ] Why these technologies, and what was rejected?
- [ ] How would this become services without a rewrite?

That is the definition of done for the portfolio, and it is a test of the documentation as much
as the code.

---

Related: [performance.md](performance.md) · [../testing/strategy.md](../testing/strategy.md) ·
[../product/roadmap.md](../product/roadmap.md)
