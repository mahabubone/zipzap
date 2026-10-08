# Surfaces

Nine user-facing surfaces plus the public API. Every one is a projection of the same event
history — none of them owns state.

---

## Inventory

| Surface                  | Package                            | Phase | Notes                                   |
| ------------------------ | ---------------------------------- | ----- | --------------------------------------- |
| Merchant Web             | `apps/frontends/merchant-web`      | 1     | Primary customer-facing app             |
| Operations Control Tower | `apps/frontends/control-tower`     | 2     | Live map, assignment, exceptions        |
| Hub Console              | `apps/frontends/hub-console`       | 2     | Scan-first, designed for a loading dock |
| Rider Mobile             | `apps/mobile-rider`                | 2     | Expo, offline-capable                   |
| Customer Tracking        | `apps/frontends/customer-tracking` | 1     | Public, no account                      |
| Support Console          | `apps/frontends/support-console`   | 4     | Cross-domain read                       |
| Admin Console            | `apps/frontends/admin-console`     | 1     | Platform configuration                  |
| Developer Portal         | `apps/frontends/developer-portal`  | 4     | API keys, webhook logs, sandbox         |
| Desktop                  | `apps/desktop`                     | 6     | Electron shell over the control tower   |
| Landing + docs site      | `apps/site`                        | 0     | Astro                                   |

Shared React components live in `packages/ui`. The API client in `packages/api-client` is
generated from the backend's OpenAPI output — never hand-written.

Ten surfaces are planned; **two exist as packages**. What each one must eventually beat in the
market is recorded in [competition/](competition/_index.md).

---

## Merchant Web

React 19 · TanStack Router, Query, Table · Tailwind · shared component library.

Sections: dashboard · shipments · orders · customers · pickup · returns · COD · settlements ·
invoices · reports · risk · API · webhooks · team · settings · support.

Dashboard metrics: total shipments, today's orders, delivered, in transit, failed, returned, COD
outstanding, available and pending settlement, average delivery time, return rate. Charts:
shipments per day, delivery success rate, return rate, COD collected, settlement history.

## Customer Tracking

`/track/:trackingCode`. No account required.

Shows tracking code, current status, origin, destination, estimated delivery, timeline, last
scan, delivery information, and a support entry point.

The visible timeline is deliberately a subset of the internal tracking events:

```
Created → Picked Up → Origin Hub → In Transit → Destination Hub
       → Out for Delivery → Delivered
```

Only what a recipient needs to know and act on. This is a purpose-built read model over the
immutable event log — it is not the internal event feed with fields removed. See
[domains/tracking.md](../domains/tracking.md).

## Rider Mobile

Expo / React Native · TanStack Query · local persistence.

Screens: authentication · dashboard · today's jobs · pickup jobs · delivery jobs · route ·
shipment detail · scan · delivery attempt · COD collection · proof of delivery · exceptions ·
notifications · profile.

### Offline rider mode

A rider loses connectivity mid-route constantly. The client queues commands locally and syncs
when the network returns.

```
Online → local command → local queue
                            ↓ network unavailable
                         Offline
                            ↓ network restored
                          Sync → server acknowledgement
```

Every queued command carries `device_id`, `command_id`, `created_at`, `operation`, `payload`.
The server must reject duplicate processing — see
[api/idempotency.md](../api/idempotency.md). This is the hardest consistency requirement in the
product: a scan performed twice on a flaky connection must still be one scan.

## Operations Control Tower

The central operational interface. Live counts: today's shipments, active pickups, in transit,
at hub, out for delivery, delivered, failed, returned, COD outstanding, riders online, hub
backlog.

Live map of hubs, riders, and destinations. Actions: inspect shipment, assign pickup, assign or
reassign rider, transfer, hold, release, initiate return, inspect delivery attempt, inspect COD,
create operational ticket.

## Hub Console

Inbound and outbound, scan-first. Manifest sealing, missing-shipment exceptions, reconciliation.

## Admin Console

Platform configuration, service areas, pricing, hubs, users, permissions, integrations, audit.

## Desktop

Electron shell wrapping the control tower. Justified by hub staff working on shared depot
machines. Additive, not a separate product.
