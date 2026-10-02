# delivery

Last mile: the job, the attempt, the proof. Phase 2.

---

## Owns

`delivery` schema: `jobs`, `attempts`, `proof`, `failure_reasons`.

## Job

```
DeliveryJob
├── shipmentId
├── riderId
├── destination
├── scheduledAt
├── attempts
├── status
└── proof
```

## State

```
CREATED → ASSIGNED → ACCEPTED → OUT_FOR_DELIVERY → ATTEMPTED
                                                     ├── DELIVERED
                                                     └── FAILED
```

## Failure

Delivery fails in the ordinary course of business. Failure reasons are structured, never free
text:

`CUSTOMER_UNAVAILABLE` · `WRONG_ADDRESS` · `PHONE_UNREACHABLE` · `CUSTOMER_REFUSED` ·
`ADDRESS_INCOMPLETE` · `PAYMENT_ISSUE` · `DAMAGED_PACKAGE` · `WEATHER` ·
`OPERATIONAL_EXCEPTION`

The reason drives the next step — retry, reschedule, contact the merchant, return, or escalate.
A free-text reason gives operations a string to read and nothing to act on.

Some reasons are retryable and some are terminal. `CUSTOMER_UNAVAILABLE` retries; `WRONG_ADDRESS`
does not. Retrying a wrong address burns rider time and delays every parcel behind it.

## Proof of delivery

Supported: **OTP** · **photo** · timestamp · GPS coordinates · rider identity.

OTP is the strongest single signal — the parcel reached the right person. Photo plus GPS proves
where and when, not to whom. Record all three where available.

Proof is sensitive: a photo of a customer's home is a privacy exposure, and GPS is a location
history. Store in object storage with access control, audit reads, and apply the retention policy
in [../operations/retention-privacy.md](../operations/retention-privacy.md).

## Rules

1. **Delivery confirmation is idempotency-keyed.** A rider confirming from a flaky connection
   twice must not produce two deliveries, two proofs, or two COD collections.
2. **Every attempt is recorded**, including failures and their reasons. Three failed attempts
   with no record are indistinguishable from three successful ones.
3. **A delivery job belongs to exactly one shipment.** A return references the original.
4. **Attempts are bounded** by a configured policy, and exhausting them triggers return rather
   than infinite retry.
5. **Proof is required for `DELIVERED`.** Not "usually supplied" — required, because a disputed
   delivery with no proof is a loss the platform cannot win.

## Emits

`DeliveryAssigned`, `DeliveryAccepted`, `DeliveryOutForDelivery`, `DeliveryAttempted`,
`DeliveryCompleted`, `DeliveryFailed`, `DeliveryProofCaptured`.

Consumers: [shipment](shipment.md) for the status transition, [cod](cod.md) for collection,
[notification](notification.md) for the recipient, [tracking](tracking.md) for the timeline.

## Must not touch

`rider` tables, `shipment` tables, `cod` tables. It holds `riderId`, `shipmentId`, and an
outcome. It does not read COD records — it emits an event and [cod](cod.md) owns the money.

---

Related: [shipment](shipment.md) · [cod](cod.md) · [returns](returns.md) ·
[rider](rider.md)
