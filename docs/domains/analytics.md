# analytics

Projections for dashboards and KPIs. Phase 6.

---

## Owns

`analytics` schema: read-only projections. No authoritative data lives here.

## The rule

> **Analytics must never slow down a transactional operation.**

Which means: no synchronous query of `analytics` inside a mutation, no join from a transactional
table into a projection, and no dashboard that runs `SELECT … FROM shipment.shipments` across
five schemas to compute a chart.

Projections are fed by events and are **rebuildable from scratch** at any time. If a projection
is not reproducible, it is not a projection — it is a second source of truth, and it will
disagree with the first.

## Projections

| Table                      | Grain          | Fed by event types                                                             |
| -------------------------- | -------------- | ------------------------------------------------------------------------------ |
| `merchant_daily_shipments` | merchant × day | `ShipmentCreated` · `PickupParcelScanned` · `DeliveryCompleted`                |
| `hub_daily_volume`         | hub code × day | `ShipmentScanned`                                                              |
| `rider_daily_performance`  | rider × day    | `DeliveryCompleted` · `DeliveryAttempted`                                      |
| `delivery_success_rate`    | day            | `DeliveryCompleted` · `DeliveryAttempted` (terminal: `retryScheduled = false`) |
| `return_rate`              | day            | `DeliveryCompleted` · `ReturnCompleted`                                        |
| `cod_summary`              | day × currency | `CODCollected` · `CODPartialCollection` · `SettlementCompleted`                |

Days are **Asia/Dhaka** buckets (`analytics/rules/day.ts`), never UTC — a Bangladesh
business day is the axis every KPI below is plotted on. The two rate tables store
integer counts, not ratios: `delivered / (delivered + failed)` is computed at read
time, so a stored rate can never drift from its inputs. Money columns are bigint
minor units with `currency` in the same row.

Two event payloads carry fields precisely so analytics never reads a transactional
table (rule 2): `DeliveryAttempted.riderId` (the only event with failure counts)
and `SettlementCompleted.currency` (money without a currency would break AGENTS.md
rule 4).

Single-tenant events are consumed through the fifth NATS consumer, `analytics`
(subscription parity is pinned in `subscriptions.spec.ts`).

## Consistency

**Explicitly eventual.** A dashboard two seconds stale is not a bug — that is what a projection
is. Anything that is _not_ allowed to be stale belongs in [cod](cod.md) or
[finance](finance.md), not here.

Every dashboard that displays a money figure must say so, or read from finance. A merchant
seeing "COD outstanding" from a projection must not assume it is the reconciled figure.

## KPIs

Delivery success rate · first-attempt delivery rate · average delivery time · pickup SLA · hub
processing time · transit time · return rate · COD collection rate · settlement time · rider
utilisation · hub backlog · exception rate.

Sourced events for each:

```
delivery success rate  = delivered / delivered + failed
first attempt rate     = delivered on attempt 1 / attempts
avg delivery time      = delivered_at - created_at
pickup SLA             = picked_up_at - pickup_requested_at
hub processing time    = dispatched_at - arrived_at_hub_at
transit time           = arrived_dest_at - dispatched_at
return rate            = returns / delivered
COD collection rate    = collected / expected
settlement time        = settled_at - period_end
rider utilisation      = active job minutes / available minutes
hub backlog            = arrived, not dispatched
exception rate         = exceptions / total shipments
```

## Rebuild

```bash
pnpm --filter @zipzap/backend analytics:rebuild --from=2026-01-01
```

It must work. If it does not, the projection has become authoritative by accident, and that is
the bug to fix before anything else in this module.

How it works: truncates all six tables and replays `system.outbox_events` — append-only, so
it holds every event ever — from `--from` (a `yyyy-mm-dd` UTC cutoff on `occurred_at`,
default `1970-01-01`) through the **same** `project()` function the live consumer runs, in
one transaction. Live and rebuild cannot disagree because there is one implementation, not
two. A crash rolls back to the pre-rebuild projections, never a half-wiped state.

## Search

PostgreSQL first — `pg_trgm`, `tsvector`, and a GIN index handle tracking-code, phone, and name
lookup at this scale. OpenSearch only when a measured query is insufficient. A search cluster
added "for scale" before it is needed is infrastructure with a running cost and no benefit.

See [../architecture/extraction.md](../architecture/extraction.md).

## Must not touch

Every transactional schema. Analytics reads nothing from them at query time. It is fed by
events, and that is the only channel.

---

Related: [../architecture/eventing.md](../architecture/eventing.md) ·
[../operations/observability.md](../operations/observability.md) ·
[merchant](merchant.md)
