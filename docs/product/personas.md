# Personas

Eight roles. Each lists what they need, not what screens they get — surfaces follow the needs,
never the reverse.

Permissions, not role names, are the enforcement unit. A persona is a bundle of permissions.
See [domains/identity.md](../domains/identity.md).

---

## Platform Owner

Owns the platform: configuration, organisations, service areas, pricing, hubs, users,
permissions, financial configuration, integrations, monitoring, audit.

Typically the person who would answer "why is COD not reconciling."

## Merchant Owner

Runs an e-commerce business. Creates shipments, imports orders in bulk, schedules pickups,
monitors deliveries and COD, manages returns, views settlements and reports, configures webhooks,
uses the API.

This is the paying customer. Their dashboard is the primary product surface.

## Merchant Operator

Works on the merchant's behalf, day to day. Create and edit shipments, request pickups, print
labels, track parcels, handle returns, view customer information. A restricted Merchant Owner —
scoped by permission, not by a separate account model.

## Operations Manager

Runs courier operations. Monitors flow, assigns and reassigns riders, watches hubs, resolves
exceptions, reroutes shipments, inspects failed deliveries, manages dispatch, watches KPIs.

Lives in the control tower. Their day is a queue of exceptions, not a dashboard.

## Hub Operator

Manages a physical hub. Receives, scans, sorts, dispatches, transfers parcels, inspects
exceptions, creates manifests.

Works in bursts when a vehicle arrives. The scan interface has to survive gloves, glare, and a
flaky connection.

## Rider

Performs pickup and last-mile delivery. Views assignments, accepts jobs, picks up, scans,
navigates, attempts delivery, collects COD, captures proof, reports exceptions, and
synchronises work done offline.

The persona with the least reliable connectivity and the most expensive mistakes. Every offline
command needs an idempotency key — see [surfaces.md](surfaces.md#offline-rider-mode).

## Customer / Recipient

Usually has no account. Tracks a parcel, receives notifications, sees status and estimated
delivery, confirms delivery, contacts support.

Must never see: the merchant's internal notes, other customers, internal hub routing, or
anything that makes the courier's operations legible as a competitive weakness. The public
tracking page is a separate, narrow read model — see [domains/tracking.md](../domains/tracking.md).

## Support Agent

Handles operational problems. Searches shipments, inspects timelines and rider/hub history,
creates tickets, communicates with merchants, escalates, resolves.

Needs read access across domains. They get it through explicit, audited queries per module —
never by breaking the module boundary.
