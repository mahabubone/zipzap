# Roadmap

Build order and phase gates live in [`../../ROADMAP.md`](../../ROADMAP.md) — that is the file to
follow when implementing. This page is the product view of the same phases.

---

## Phase 1 — Foundation domain

Identity · merchant · shipment · tracking · pricing · geo

The minimum needed to accept an order and show where it is. Everything downstream is a consumer
of these facts.

## Phase 2 — Logistics

Pickup · rider · hub · network · manifest · delivery · returns

Movement. This is where the product stops being an order form and becomes a courier.

## Phase 3 — Finance

COD · ledger · settlement

Money. The phase where correctness stops being optional, because here a bug is not a bug — it
is a disputed payment.

## Phase 4 — Platform

Public API v1 · webhooks · bulk import · notifications · risk signals · support · developer
portal · sandbox

Self-service and integration. The point at which a merchant can run on ZipZap without talking
to a human.

## Phase 5 — Advanced logistics

PostGIS routing · serviceability · hub network · rider optimization · offline rider mode ·
SLA calculation

Depth in the network model.

## Phase 6 — Operations

Control tower · analytics projections · simulation engine · load testing · operational reports ·
observability maturity

Running it at volume, and proving it.

---

## MVP

Authentication · merchant · shipment · pickup · rider · hub · tracking · delivery · COD ·
return · settlement · merchant dashboard · rider app · tracking page · operations console ·
API · webhooks.

That is already a substantial product. It is the honest definition of "MVP" here — anything
smaller does not demonstrate the thing worth demonstrating, which is that the whole chain
composes correctly.

## Portfolio demonstration

One story, told end to end, visible in five places simultaneously.

```
merchant creates order → pricing → pickup → rider assigned → picked up → origin hub scan
→ dispatch → destination hub → rider assigned → out for delivery → customer receives parcel
→ COD collected → delivered → merchant webhook → COD reconciliation → settlement
```

The same event reflected in: merchant dashboard · operations console · rider app · customer
tracking page · financial dashboard.

The demo should also deliberately show failure handling, because that is the part that
distinguishes this from a CRUD app:

- a duplicated request rejected by idempotency
- a webhook that fails and retries on a visible schedule
- a delivery that fails, retries, and returns
- COD that does not reconcile, and the compensating entry that fixes it
- a process killed mid-flight and recovering without loss or duplication

## Beyond

Candidate directions, not commitments: fulfillment · warehousing · packaging as a service ·
merchant SDKs in other languages · additional markets.

Each has a named trigger in the deferred table in [`../../ROADMAP.md`](../../ROADMAP.md).
