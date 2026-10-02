# pickup

First-mile collection, as a first-class workflow. Phase 2.

---

## Owns

`pickup` schema: `requests`, `batches`, `assignments`, `attempts`.

## Flow

```
Merchant → Pickup request → Pickup assignment → Rider → Merchant location
         → Parcel scan → Pickup complete
```

## Entities

`PickupRequest` · `PickupBatch` · `PickupAssignment` · `PickupAttempt`

## Batching

A merchant typically has many parcels going out at once. One assignment per parcel is
unworkable for the rider and wasteful for the operation.

```
Shipment 1 ┐
Shipment 2 ├─→ Pickup batch ──→ one rider assignment
Shipment 3 ┤
Shipment 4 ┘
```

The rider gets one job. The batch owns its membership, so adding a parcel after assignment is a
batch operation with its own rules — never a silent insertion into an in-flight job.

## Rules

1. **A pickup request is idempotency-keyed.** A rider on a flaky connection re-requesting must
   not create a second job.
2. **One active assignment per pickup at a time.** Reassignment closes the previous one with a
   reason; it does not overwrite it.
3. **A pickup attempt records outcome and reason**, including failure. "Rider arrived, merchant
   absent" is data the operations team needs.
4. **Batching is bounded** — by parcel count, weight, or time window. An unbounded batch is a
   rider's entire day decided by one merchant.
5. **Scan is required to complete.** "Picked up" without a scan per parcel is a rider marking
   parcels picked up they never touched.

## State

Request: `REQUESTED → SCHEDULED → ASSIGNED → IN_PROGRESS → COMPLETED`
· with `FAILED`, `EXPIRED`, `CANCELLED`.

`ExpirePickupRequest` is a scheduled job — a request nobody honours should not stay open
indefinitely.

## Must not touch

`rider` tables (it holds `riderId`), `shipment` tables (it holds `shipmentId`s),
`merchant` tables.

## Emits

`PickupRequested`, `PickupAssigned`, `PickupReassigned`, `PickupStarted`, `PickupCompleted`,
`PickupFailed`, `PickupExpired`.

Consumers: [rider](rider.md) for assignment, [notification](notification.md) for the merchant
and the rider, [analytics](analytics.md) for pickup-SLA measurement.

---

Related: [rider](rider.md) · [shipment](shipment.md) · [notification](notification.md)
