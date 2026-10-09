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

### Lookup: code or token

Two public routes, both rate-limited per IP at 100/min, both reading only this projection:

| Route | Space | Use |
| --- | --- | --- |
| `/track/:trackingCode` | `ZP-` + 10 chars of a 32-letter alphabet ≈ 1.1e15 | Links already sent to customers |
| `/track/token/:token` | 26 chars of the same alphabet = 130 bits | Links issued from now on |

The token is **added alongside** the code, not swapped for it. Every code-shaped link already sits
in a customer's inbox or on a printed label; replacing the route breaks all of them to fix a problem
that only exists for new links. Both 404 identically — same envelope, same `detail`, differing only
in `request_id` — because a token route that answers differently for a hit and a miss is a validity
oracle for tokens.

`tracking.public_tokens` holds one row per parcel, keyed by `shipment_id`, minted by the projection
consumer with `ON CONFLICT (shipment_id) DO NOTHING` so a replayed event cannot rotate a link a
customer has already bookmarked. It lives in this schema rather than on `shipment.shipments` so the
public route never opens the shipment connection (rule 2).

No revocation, and no second token — one live link per parcel is the whole feature. A merchant who
wants a link to stop working rotates the tracking code, which is the only other identifier a customer
would have quoted.

### Known defect: `public_timeline.sequence` is not unique

The consumer allocates `sequence` as `MAX(sequence) + 1` read inside its own transaction, with no
lock on the tracking code. Two events projected concurrently read the same maximum and write the same
number. 1,658 colliding `(tracking_code, sequence)` pairs exist on the seeded database.

Reads therefore order by `sequence, occurred_at, id`. Without the tiebreak, `ORDER BY sequence` is a
partial order and Postgres does not return tied rows the same way twice — two routes over the same
rows returned them in different orders, and because `status` is read off the last row, one parcel
reported two current states.

The allocation race itself is unfixed: a unique index cannot be added while duplicates exist, and
rule 8 forbids tidying history by editing rows. Fixing it means a repair migration (renumber, as new
appending rows) plus `SELECT ... FOR UPDATE` or an advisory lock in the consumer.

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
