# ADR-0011: PostGIS with `geography`, not `geometry`

**Status** accepted · 2026-10-02

## Context

Riders move between coordinates. Service areas are polygons. Coverage is asked as "is this
address inside this zone, and how long does delivery take". Both distance and containment are
core operations, and both are wrong if the spatial math is wrong.

## Decision

**PostGIS with the `geography` type, SRID 4326, `GIST` indexes on every geometry column.**

```sql
location   geography(Point, 4326)      NOT NULL,
area       geography(MultiPolygon, 4326)
```

`geography` measures on a spheroid and returns real metres. `geometry` treats the plane as flat
and returns coordinate units.

This is not a theoretical preference. Bangladesh spans roughly 20.5°N–26.6°N, where a degree of
longitude is about 97 km and a degree of latitude about 111 km. Plane maths across a district is
meaningfully wrong — enough to mis-rank rider assignments and to place a delivery point outside
its own zone.

### Coverage is data

```sql
service_area
  ├── serviceable
  ├── estimated_days
  ├── pickup_available
  ├── delivery_available
  └── COD_available
```

Never `if (city === 'Dhaka')`. If next-day delivery stops being available in a zone, that is a
data edit, not a deploy. See [../domains/network.md](../domains/network.md#coverage-is-data).

### Serviceability is checked before creation

Geo resolution → service area lookup → serviceability → SLA → pricing category. An unserviceable
destination is rejected at creation, not discovered three days later after the parcel is on a
truck.

## Consequences

### Positive

- Distances in metres are correct everywhere in the service area.
- `ST_DWithin`, `ST_Contains`, `ST_Intersects` on real geometry.
- `geography` is slower than `geometry` — and that cost is paid deliberately to avoid being wrong.
- Coverage, SLA, and pricing zones are all data, so the network is configurable.
- `GIST` indexes make the spatial queries fast enough to run on every shipment creation.

### Negative

- **`geography` is measurably slower than `geometry`.** Accepted; correctness first. Add cached
  or precomputed geometry columns only if a measured query requires it.
- Spatial indexes are larger and slower to build than B-tree indexes.
- Requires a PostGIS-enabled image, so `pg/postgis:18` rather than `postgres:18`.
- Geographic data needs maintenance: upazila boundaries change, and stale boundaries produce
  confidently wrong serviceability.

## Alternatives considered

**Plain `geometry`.** Faster, and wrong at this latitude. Rejected — this is the one decision in
the list where the performance saving is real and the correctness cost is silent.

**Store latitude/longitude as `numeric` columns, compute in application.** Rejected: no spatial
indexes, so `ST_DWithin` becomes a full scan, and polygon containment would be hand-rolled and
slowly wrong.

**External geocoding and routing APIs (Google, Mapbox, OSRM).** Rejected for zone containment and
serviceability, which are our own data, not theirs. Reconsider for turn-by-turn navigation in the
rider app — that is genuinely their problem, and it belongs behind an interface.

**A hierarchical district/upazila lookup instead of polygons.** Rejected as the only model:
precise enough for service areas, but arbitrary polygons are needed for remote-area and
COD-availability rules that do not follow administrative lines.

**Separate PostGIS server.** Rejected: no reason to split a workload Postgres handles well. Revisit
if spatial queries start competing with transactional ones for CPU.
