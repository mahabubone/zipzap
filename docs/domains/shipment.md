# shipment

The central aggregate. Phase 1.

---

## Owns

`shipment` schema: `shipments`, `parcels`, `scans`.

```
Shipment
├── id, trackingCode
├── merchantId            (identifier, not FK)
├── sender                name, phone, address
├── recipient             name, phone, address
├── origin / destination  geography
├── parcel                count, weight, dimensions, description
├── pricingVersion        frozen at creation
├── cod                   expected amount
├── status                current state
└── deliveryWindow        SLA commitment
```

## Rules

1. **The status machine owns the status.** Never `UPDATE shipment.shipments SET status`. The
   full transition table is in
   [../architecture/state-machines.md](../architecture/state-machines.md#shipment).
   Cross-module callers (pickup, hub scans, delivery) go through
   `ShipmentAdvanceService` — it takes the caller's transaction manager, locks the row,
   asserts the transition and writes qualified SQL. It writes the status column only: the
   operation that caused the movement announces the fact through its own outbox event.
2. **Tracking codes are unique, non-sequential, and non-guessable.** `ZP-8F32A1`. A guessable
   code is a customer-address enumeration vector on a public endpoint.
3. **A return references the original shipment.** Never create a second, unrelated parcel.
4. **Pricing is frozen.** The shipment stores the `pricingVersion` used at creation. A later
   price change must not rewrite what the merchant was charged.
5. **Serviceability is checked before creation.** An unserviceable destination is rejected with a
   reason, not created and failed later.
6. **Creation is idempotency-keyed.** A retried create returns the original shipment.
7. **Every transition appends a scan and a tracking event.** One business fact, one record.
8. **Transitions serialise on the shipment row** (`SELECT … FOR UPDATE`). Two riders scanning
   simultaneously must not both advance the machine.

## Scans

Every physical handover is a scan:

```
scan_id · shipment_id · actor_id · actor_type · location
scan_type · device_id · timestamp · metadata
```

Types: `SCAN_PICKUP`, `SCAN_HUB_IN`, `SCAN_HUB_SORT`, `SCAN_HUB_OUT`, `SCAN_DELIVERY`,
`SCAN_RETURN`.

A status change with no scan is an administrative override, and it is recorded as one — actor,
reason, both timestamps. Overrides are legitimate; silent ones are not.

## Emits

`ShipmentCreated`, `ShipmentPickupRequested`, `ShipmentPickedUp`, `ShipmentArrivedAtHub`,
`ShipmentDispatched`, `ShipmentArrivedAtDestinationHub`, `ShipmentOutForDelivery`,
`ShipmentDelivered`, `ShipmentDeliveryFailed`, `ShipmentCancelled`, `ShipmentOnHold`,
`ShipmentReleased`.

## Consumes

`ReturnInitiated` — to move the forward lifecycle into its return branch.

## Must not touch

- `merchant` tables — it holds `merchantId`, not a merchant record
- `customer` tables — recipient data is copied onto the shipment at creation, because it is a
  point-in-time fact. The customer's address _yesterday_ is not the address on the parcel
- `tracking` tables — the tracking module owns its append-only log; shipment tells it what
  happened via the application service or an event
- `pricing` tables — it stores the frozen quote, not the rules

## Risk signals

Risk scoring reads customer and merchant history at creation and produces a score plus the
signals behind it. Decision support for a human, never an automatic block and never an
accusation. Signals are stored and explained; the model is not hidden.

## Labels

Tracking code → shipment. Labels and barcodes encode the tracking code only — never a name,
phone, or address. A barcode on a lost parcel must not be a privacy incident.

---

Related: [tracking](tracking.md) · [pricing](pricing.md) · [delivery](delivery.md) ·
[returns](returns.md) · [network](network.md)
