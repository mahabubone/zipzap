# network

Zones, routes, manifests, and the geographic model. Phase 2 / Phase 5 rungs 1–2.

**Landed 2026-10-05**: `service_areas` coverage table (migration 0023) + the serviceability
gate at shipment creation; `geo_areas` hierarchy (migration 0024) — 8 divisions, 64
districts, 20 sample upazilas, `boundary geography(MultiPolygon, 4326)` with a GiST index
(boundaries NULL until real boundary data is imported); routes, trips and manifests
(migration 0026) — two seeded line-haul corridors, the five-edge manifest machine, and the
reconciliation check that refuses to pass while cargo is missing. Still to come: `zones`,
`transports`, real boundary polygons, SLA maths.

---

## Owns

`network` schema: `service_areas`, `geo_areas`, `routes`, `route_legs`, `trips`,
`manifests`, `manifest_items` (landed); `zones`, `transports` and route geometry still to
come.

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

An estimated delivery date is computed at serviceability time from the zone's `estimated_days`
counted in business days, adjusted for the Asia/Dhaka pickup cutoff and the holiday calendar.
Phase 5 rung 3.

```
coverage.estimated_days  -- business days from dispatch to delivery (data, not code)
network.zone_cutoffs     -- pickup_cutoff / delivery_cutoff per zone (18:00 / 20:00 default)
network.holidays         -- non-weekend non-working days
```

`NetworkService.estimateDelivery(zone, now)` normalizes `now` to Asia/Dhaka: if it is past the
zone's `pickup_cutoff` (default 18:00) the dispatch slides to the next business day; the
`estimated_days` are then counted forward, skipping Bangladesh workweek holidays
(Sunday-Thursday workweek, holidays in `network.holidays`). The result is a due-by date, not a
time — a 2026-10-05 19:00 Dhaka request with `estimated_days = 1` and a holiday on the next
business day returns the day after that.

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
