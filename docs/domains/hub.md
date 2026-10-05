# hub

Physical logistics nodes and the work done inside them. Phase 2.

**Landed 2026-10-05**: the `hubs` table (migration 0025) — code, kind, `geography(Point, 4326)`
location with GiST, seeded with 6 hubs on the Dhaka/Chattogram/Sylhet corridors. The module
owns the schema; staff, capacity, schedules and the scan workflow arrive with their first
consumer. Nobody outside this module reads `hub.*` — route legs reference hubs by bare
identifier (ADR-0002).

---

## Owns

`hub` schema: `hubs` (landed); `zones`, `staff`, `capacity`, `schedules`, `routes` still to
come.

## Types

`REGIONAL_HUB` · `DISTRICT_HUB` · `LOCAL_HUB` · `DELIVERY_POINT`

The type matters because it determines capacity model, SLA, and which legs of a route a hub can
participate in. A delivery point has no outbound line-haul.

## Inbound

```
Truck / Rider → Hub gate → Scan in → Sort → Destination
```

## Outbound

```
Shipment → Dispatch batch → Manifest → Vehicle / Rider → Scan out
```

## Rules

1. **Every handover is a scan.** Inbound, sort, outbound. A parcel moving without a scan has no
   custody record, and "who had it" becomes unanswerable.
2. **Capacity is modelled.** A hub with a physical limit needs it represented, or "hub backlog"
   is a metric nobody can act on.
3. **Staff assignments are scoped to a hub.** A hub operator sees that hub, not all of them.
4. **Discrepancies surface as exceptions.** Received-but-not-on-manifest, manifested-but-not-
   received, and received-twice all raise rather than silently reconcile.

## Design constraint: the console

Hub staff scan on a loading dock. The console is designed for:

- gloves (large targets)
- glare (high contrast)
- a dropped connection (queued scans, visible sync state)
- bursts (a truck arrives with 200 parcels at once)
- low technical tolerance (no training, no patience)

A hub console optimised for desktop aesthetics and used by someone holding a phone in the rain is
a console that gets bypassed — and a bypassed scan is a parcel with no custody record.

## Emits

`HubArrivalScanned`, `HubSorted`, `HubDispatchScanned`, `HubCapacityExceeded`,
`HubDiscrepancyDetected`.

## Must not touch

`network` tables (manifests live there — a hub records scans against a manifest, it does not
own it), `shipment` tables, `rider` tables.

---

Related: [network](network.md) · [shipment](shipment.md) · [rider](rider.md)
