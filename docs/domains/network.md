# network

Zones, routes, manifests, and the geographic model. Phase 2.

---

## Owns

`network` schema: `zones`, `service_areas`, `routes`, `route_legs`, `transports`, `trips`,
`manifests`, `manifest_items`, and the geographic hierarchy.

---

## Geo and serviceability

The Bangladesh hierarchy:

```
Division → District → Upazila → Union → Ward / Area → Delivery Point
```

PostGIS `geography(…, 4326)`, not `geometry` — correct distance in metres without planar
approximation. See [../architecture/database.md](../architecture/database.md#types-that-matter).

### Coverage is data

```
service_area
  ├── serviceable
  ├── estimated_days
  ├── pickup_available
  ├── delivery_available
  └── COD_available
```

Never `if (city === 'Dhaka')`. If Dhaka stops being next-day, that is a data edit, not a
deploy. This distinction is the difference between a configurable product and a hardcoded demo.

### Serviceability check

Runs **before** a shipment is created:

```
destination → geo resolution → service area lookup → serviceability
            → delivery SLA → pricing category
```

Result: `serviceable`, `zone`, `hub`, `estimated_delivery`, `pricing_category`.

An unserviceable destination is rejected with a reason at creation. Discovering it three days
later, after the parcel is on a truck, is an operational cost the check exists to avoid.

## Routes

```
Pickup zone → Origin hub → Regional hub → Destination hub → Delivery point → Customer
```

`Route` is a template; `RouteLeg` is one hop; `Trip` is one actual movement.

The initial implementation is a fixed topology. Dynamic routing, capacity-aware routing, and
multi-stop rider optimisation are Phase 5, and each has a named trigger in
[`../../ROADMAP.md`](../../ROADMAP.md).

## Manifests

A manifest groups shipments moving together between two hubs.

```
DRAFT → SEALED → DISPATCHED → RECEIVED → RECONCILED
```

```
Manifest
├── origin, destination
├── transport, driver
├── created_at
└── shipments[]
```

`SEALED` is the commitment. After sealing, the contents do not change — an addition or removal
is a new manifest.

At `RECONCILED`, every sealed shipment must be accounted for. **A missing shipment becomes an
exception.** Silence is never the answer: an unreconciled manifest that quietly loses a parcel is
how parcels disappear, and that is the failure this whole domain exists to make impossible.

## Line-haul

Origin hub → dispatch → transit → destination hub. Modelled as a manifest travelling on a trip.
The foundation for a regional network, without committing to one.

## Must not touch

`shipment`, `hub`, `delivery` tables. A manifest holds `shipmentId`s; it does not read shipment
rows. Discrepancy detection asks the shipment module, or reconciles against events.

## Emits

`ManifestSealed`, `ManifestDispatched`, `ManifestReceived`, `ManifestReconciled`,
`ManifestDiscrepancyDetected`.

---

Related: [hub](hub.md) · [shipment](shipment.md) · [pricing](pricing.md) ·
[rider](rider.md)
