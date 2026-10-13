# hub

Physical logistics nodes and the work done inside them. Phase 2.

**Landed 2026-10-05**: the `hubs` table (migration 0025) — code, kind, `geography(Point, 4326)`
location with GiST, seeded with 6 hubs on the Dhaka/Chattogram/Sylhet corridors. The module
owns the schema; staff, capacity, schedules and the scan workflow arrive with their first
consumer. Nobody outside this module reads `hub.*` — route legs reference hubs by bare
identifier (ADR-0002).

**Landed 2026-10-09**: `parcel_presence` (migration 0040) — what is physically waiting at a hub,
and the first table here whose consumer is a screen. Before it, a scan only _validated_ the
`hubCode` it was given; "what is waiting at my hub" had no answer. `shipment.shipments` has no
`hub_id`, and adding one would mean the hub module writing another module's table (rule 2), so
presence is recorded here at scan time and joined to nothing.

Not append-only, deliberately: this is the present tense, not history. A parcel that has left is
**deleted**, not flagged — because "not at any hub" and "at a hub but we forgot to clear it" are
different states, and a soft flag would collapse them.

**Landed 2026-10-12**: `staff` (migration 0050) — who works at which hub, and in what role
(`MANAGER` | `OPERATOR`). A dated assignment table, not a `hub_id` column on the user, because
reassignment is normal and a single column keeps no history. A partial unique index on `user_id`
where `revoked_at IS NULL` enforces one active hub per person at the database, not in app code.
No FKs to `identity.users` (ADR-0002); the service verifies a user exists via `UserService`
before assigning. The `HUB_MANAGER` role (`HUB_OPERATOR` scopes + `hub:manage`) and the
`hub:manage` scope arrived with it.

---

## Owns

`hub` schema: `hubs` (landed); `parcel_presence` (landed); `staff` (landed); `zones`, `capacity`,
`schedules`, `routes` still to come.

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

## Hub staff assignment (landed 2026-10-12)

`hub.staff` now exists and answers "who works at which hub". A `HUB_OPERATOR` or `HUB_MANAGER` is
assigned to exactly one active hub (partial unique index on `user_id` where `revoked_at IS NULL`),
and `GET /v1/hubs/my-hub` returns it — so the hub console lands directly on the operator's hub
instead of a picker. A person between hubs gets a 404, which the console renders as "contact your
manager" rather than a login redirect.

The session model still expresses a platform employee as a merchant membership (the workaround
remains), but the assignment is now a real row in `hub.staff` rather than inferred from the
membership. The permission split is unchanged: `hub:read`, `hub:scan`, and `hub:manage` are
platform scopes, listed in `PLATFORM_SCOPES` and subtracted from `MERCHANT_SCOPES`, so a scope
added tomorrow is withheld from merchants by default. See [identity.md](identity.md).

## The arrival gesture belongs to the manifest

`DEPARTED` removes a parcel from `parcel_presence` — it has left the building. That has a consequence
the API never revealed and the browser proof did: `ARRIVED` is therefore on **no hub's work list**,
because a parcel in line-haul is at no hub. The hub console records it from the manifest detail
instead, against the cargo list that still knows the parcel was expected. If a second arrival path is
ever wanted — a walk-in at a destination hub — that is a screen decision, not a schema one, and
`parcel_presence` already holds what it would need.

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
