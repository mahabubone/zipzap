# dashboard — the control-tower read surface

**Phase 6, rung 1.** A read-only API surface that reports live network counts across all
domain modules. It is the first operations feature: a control tower that answers "what does
the network look like right now?"

## What it exposes

`GET /v1/control-tower/live-counts` (API-Key guarded) returns a single `LiveCounts`
snapshot:

- **shipments** — total, `todayNew`, `inTransit`, `atHub`, `sorting`, `outForDelivery`,
  `delivered`, `failed`, `returned`, `returning` (full return lifecycle), `cancelled`,
  `onHold`, `lostOrDamaged`, `exception`, plus a complete `byStatus` map.
- **pickups** — total, `active`, `pending`, `completed`, `failed`, `expired`, `cancelled`,
  `byStatus`.
- **deliveries** — total, `outForDelivery`, `attempted`, `attemptsRemaining`
  (ATTEMPTED jobs with retry budget), `failed`, `delivered`, `byStatus`.
- **cod** — total, `expected`, `outstanding` (collected-but-not-settled),
  `outstandingAmountMinor` (integer minor units, `bigint`), `byStatus`.
- **riders** — total, `online`, `available`, `offline`, `suspended`, `byStatus`.
- **hub** — `backlog` (shipments at a hub or sorting), `networkHubs`.

Each field is a sum/count over exactly one module's table — no field is synthesized from
another module's data.

## The operational report

**Phase 6, rung 6.** `GET /v1/control-tower/report?from=yyyy-mm-dd&to=yyyy-mm-dd` (API-Key
guarded, both dates inclusive, default last 30 days ending today) returns one payload with
two time-views:

- **Historical** — KPIs summed from the `analytics` projections over the day range
  (shipments flow, delivery success rate, return rate, COD currency KPIs, rider work, hub
  volume). Rates are `null` for an empty window, never `0` — see
  [analytics.md](analytics.md).
- **Live** — the point-in-time operational numbers (hub backlog, exceptions, rider counts,
  pool utilisation), taken from the existing read contracts above, not re-implemented.

The report reads projections through `ProjectionQueriesService` (owned by `AnalyticsModule`)
and never touches a transactional schema. Deferred KPIs — duration metrics, first-attempt
rate, settlement time — and why are documented in [analytics.md](analytics.md).

## Architecture

**Cross-module reads, no cross-module writes or joins.** Each count is a single-schema
read owned by one domain module; the dashboard never joins across schemas and never reads
another module's tables through another module's repository. It aggregates many such
single-schema reads, each going through the owner module's own connection manager, and
takes the whole snapshot in one micro-batch so the numbers describe one instant of the live
system. Nothing is written here, so no transaction is required.

The `LiveCounts` contract and the per-module `counts*` repository methods are the read
contracts. The dashboard (`DashboardService`) owns the aggregation; the controller is thin.

Reads through this contract are idempotent and cheap — the heavy queries are single
`GROUP BY status` aggregations (one per schema) plus indexed single-status counts.

## Ownership

- `apps/backend/src/modules/dashboard/` owns the `dashboard` surface: `dashboard.service.ts`,
  `dashboard.controller.ts`, `dashboard.module.ts`.
- The `dashboard` schema exists as an explicit marker (a zero-entity, schema-scoped
  connection) so the control tower has its own identity in the schema map; it owns no data.
- The `dashboard` schema name is registered in `apps/backend/src/database/schemas.ts` so
  the boundary checker knows it.
- `getLiveCounts()` reads `shipment`, `pickup`, `delivery`, `cod`, `rider`, `hub` through
  their own repositories — one query per schema.

## Testing

- Unit: `src/modules/dashboard/dashboard.service.spec.ts` — 11 tests against mocked
  per-schema DataSources and repositories; asserts every section, the `byStatus` completeness
  (zeroes for empty statuses), the `bigint` COD amount, and that hub backlog = `atHub` +
  `sorting`.
- Integration: `test/integration/dashboard.integration.test.ts` — 3 tests against the live
  DB; seeds cross-module data, asserts exact counts, verifies a delivered shipment moves the
  `delivered` counter, and exercises the `atHub`/`sorting` ↔ `hub.backlog` relationship by
  moving shipments and restoring them.

## Relationship to other phases

- **Phase 6, rung 1** — this surface. It is the prerequisite for later live-count work
  (`/metrics`, analytics schemas) because it proves the read contracts without touching any
  domain state.
- Later ops surfaces (`/metrics` on each entrypoint, analytics schema + rebuild) should re-use
  these same repository counts rather than re-implementing them.
