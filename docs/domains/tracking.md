# tracking

Append-only movement history, plus the public read model. Phase 1. First extraction candidate.

---

## Owns

`tracking` schema: `events`, and a projection backing the public tracking page.

```
tracking.events
  event_id · shipment_id · event_type
  location_id · hub_id · rider_id
  occurred_at · recorded_at
  metadata · actor
```

## Rules

1. **Immutable.** Never updated, never deleted. `REVOKE UPDATE, DELETE` at the database level.
2. **Corrections are new events.** A mistaken scan gets a correcting event that references it.
   The mistake stays visible — that is what makes the history defensible.
3. **`occurred_at` ≠ `recorded_at`.** A rider scan recorded on a flaky connection happens at one
   time and lands at another. Both are needed.
4. **Public events are a separate table or a flagged projection**, not a filter applied at query
   time. The public read model must be impossible to over-fetch from.
5. **High volume.** This is the largest table in the system by a wide margin. It is also the
   most read. It is the first thing to move to its own database.

## Events

`SHIPMENT_CREATED`, `PICKUP_ASSIGNED`, `PICKED_UP`, `ARRIVED_AT_HUB`, `SORTED`, `DISPATCHED`,
`ARRIVED_AT_DESTINATION_HUB`, `OUT_FOR_DELIVERY`, `DELIVERY_ATTEMPTED`, `DELIVERED`,
`RETURN_INITIATED`, `RETURNED`.

Plus corrections: `EVENT_CORRECTED`, referencing the original `event_id`.

## Public read model

`/track/:trackingCode`, no account. Purpose-built, not the internal feed with columns dropped:

```
Created → Picked Up → Origin Hub → In Transit → Destination Hub
       → Out for Delivery → Delivered
```

A recipient must never see: the merchant's identity or notes, internal routing and manifests,
other recipients, rider names or contact details, internal exception reasons, or anything that
makes the network's topology legible.

Two reasons this is a separate projection rather than a filtered query:

- **Privacy by construction.** The dangerous fields are not in the read model, so there is no
  query to get wrong and no filter to forget.
- **Cost.** The public page is the highest-QPS read in the system and needs one narrow index,
  not the full event history.

## Volume

At national courier scale, the internal event table grows by millions of rows daily. Whatever is
built here has to assume that partitioning and retention are not optional later. See
[../architecture/database.md](../architecture/database.md#retention).

## Consumes

Shipment and delivery lifecycle events, to build the timeline. Consumer is idempotent — events
replay after a restart, and a duplicate timeline entry is a visible bug.

## Must not touch

`shipment` tables. It holds `shipment_id`. If it needs merchant or recipient detail for the
public view, it was handed it in the event payload or it asks the owning module.

---

Related: [shipment](shipment.md) · [../api/errors.md](../api/errors.md) ·
[../architecture/eventing.md](../architecture/eventing.md)
