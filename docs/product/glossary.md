# Glossary

Domain vocabulary. Where a term has a precise definition in code, this is the pointer, not the
authority — the source of truth for each is noted per entry.

---

**COD** — Cash on Delivery. The merchant is owed cash that the rider collected from the
recipient at the moment of delivery. The single largest source of operational and financial
complexity in the product: it is physical, unbanked, collected by a third party, and
disputed after the fact. See [domains/cod.md](../domains/cod.md).

**Ledger** — Append-only record of every money movement affecting a merchant account. Never a
mutable balance field. Balances are derived. Corrections are compensating entries, never
updates. See [architecture/money-and-ledger.md](../architecture/money-and-ledger.md).

**Settlement** — The process of taking reconciled COD and fees, netting them against a
contract, and paying the merchant: batch → approval → payment initiation → confirmation →
settled. See [domains/finance.md](../domains/finance.md).

**Shipment** — The central aggregate. One physical parcel moving through the network.
Distinct from a _parcel_ (what is inside it) and from an _order_ (the merchant's commercial
record, of which a shipment is one fulfilment). See [domains/shipment.md](../domains/shipment.md).

**Scan** — A recorded physical handover: scan id, shipment, actor (type and id), location, scan
type, device, timestamp, metadata. Every movement in the network is a scan; a status change
without one is an administrative override, and is recorded as such.

**Tracking event** — An immutable row in the append-only history of a shipment's movement.
Corrections create new events rather than rewriting history. See
[domains/tracking.md](../domains/tracking.md).

**Line-haul** — Movement of parcels between hubs, as opposed to the first and last mile.
Modelled as a _manifest_ travelling on a _trip_. See [domains/network.md](../domains/network.md).

**Manifest** — The sealed list of shipments moving together on one vehicle between two hubs.
Lifecycle: `DRAFT → SEALED → DISPATCHED → RECEIVED → RECONCILED`. A shipment on a sealed
manifest that does not arrive is an exception, not a silent gap.

**Hub** — A physical logistics node. Typed as `REGIONAL_HUB`, `DISTRICT_HUB`, `LOCAL_HUB`, or
`DELIVERY_POINT`. See [domains/hub.md](../domains/hub.md).

**Pickup** — First-mile collection from a merchant, as a first-class workflow rather than an
implicit side effect of shipment creation. Requests are batched so one rider receives one
assignment covering many parcels. See [domains/pickup.md](../domains/pickup.md).

**Assignment** — The link between a rider and a pickup or delivery job. Scored
deterministically and explainably. Not claimed to be optimal. See
[domains/rider.md](../domains/rider.md).

**Proof of delivery** — Evidence a delivery happened: OTP, photo, timestamp, GPS coordinates,
rider identity. See [domains/delivery.md](../domains/delivery.md).

**Service area** — A geographic polygon with an explicit service level: serviceable, estimated
days, pickup available, delivery available, COD available. Coverage is _data_, never
`if (city === 'Dhaka')`. See [domains/network.md](../domains/network.md#geo--serviceability).

**Serviceability** — Whether a shipment may be created to a destination at all, and at what SLA
and price. Checked before creation. See [network.md](../domains/network.md).

**Outbox** — Table written inside the same transaction as a state change, drained by a separate
publisher. The mechanism that makes "update the database and publish the event" a single atomic
act. See [architecture/eventing.md](../architecture/eventing.md).

**Outbox publisher** — The only process permitted to publish to NATS. Owns exactly that
responsibility. See [architecture/eventing.md](../architecture/eventing.md).

**Domain event** — A statement of a business fact that has already happened
(`ShipmentDelivered`). Distinct from the database change that recorded it. See
[architecture/module-boundaries.md](../architecture/module-boundaries.md#domain-event-vs-database-change).

**Money** — An integer count of minor units plus a currency code. `125050` poisha. Never a
float. See [architecture/money-and-ledger.md](../architecture/money-and-ledger.md).

**Poisha** — One hundredth of a BDT. The minor unit of Bangladeshi taka.

**Idempotency key** — A client-supplied token making a retried mutation safe. See
[api/idempotency.md](../api/idempotency.md).

**Permissions** — The unit of authorisation (`shipment:create`, `settlement:approve`). Roles
are bundles of permissions. See [domains/identity.md](../domains/identity.md).

**Risk signal** — An input to a risk score, with a human-readable explanation. Decision support
for a human, never an automated accusation or a silent block. See
[domains/shipment.md](../domains/shipment.md).

**Outbox, NATS, BullMQ** — NATS says _what happened_. BullMQ _does the work_. Conflating them
is the most common architectural mistake in systems of this shape. See
[architecture/eventing.md](../architecture/eventing.md).

**Compensating entry** — A ledger row that undoes a prior row. Corrections are additive; nothing
is ever updated or deleted. See [architecture/money-and-ledger.md](../architecture/money-and-ledger.md).
