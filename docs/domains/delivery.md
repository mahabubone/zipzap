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

`delivery.delivery_proofs`, one row per job, in two states.

`PENDING` is a live challenge: a hashed code, its salt, when it was issued, when it expires, and
how many of the five attempts are gone. Mutable, because a challenge is session state.
`VERIFIED` is the redemption — the code the recipient read out, the photo's bytes and SHA-256, the
coordinates, and who captured it. Immutable from that instant by trigger, because this is the
record a dispute is answered from.

The OTP is the strongest single signal: a photo proves a camera was pointed at a door, only a code
proves somebody inside chose to confirm. It is stored as a salted SHA-256 and compared in constant
time — a plaintext code in a table is a code that leaks in a database dump. Five attempts, ten
minutes, whichever comes first. A wrong guess is recorded even though the request fails, or the
budget would be free.

Photo bytes live in Postgres (`bytea`, capped at 2 MB by a CHECK), not in object storage. At one
2 MB row per delivery this is the smaller, more honest choice: the photo the merchant is shown and
the photo the rider submitted are the same row, with no second store to fall out of sync and no
orphaned object to reconcile. `photo_sha256` already exists for the day that stops being true —
moving the bytes to MinIO then is one repository method and one dropped column. Access control and
retention follow [../operations/retention-privacy.md](../operations/retention-privacy.md).

## Rules

1. **Delivery confirmation is idempotency-keyed.** A rider confirming from a flaky connection
   twice must not produce two deliveries, two proofs, or two COD collections.
2. **Every attempt is recorded**, including failures and their reasons. Three failed attempts
   with no record are indistinguishable from three successful ones.
3. **A delivery job belongs to exactly one shipment.** A return references the original.
4. **Attempts are bounded** by a configured policy, and exhausting them triggers return rather
   than infinite retry.
5. **Proof is required for `DELIVERED`.** Not "usually supplied" — required, because a disputed
   delivery with no proof is a loss the platform cannot win. `POST /v1/deliveries/:id/complete`
   raises `PROOF_REQUIRED` without a `VERIFIED` proof, and a `VERIFIED` row missing any one of the
   three evidence columns cannot be written at all — the CHECK is the rule, not the service.
6. **A proof is captured at a door, and only at a door.** Codes are issued only for a job that is
   `OUT_FOR_DELIVERY` or `ATTEMPTED`; one job gets exactly one proof, enforced by a unique index
   rather than by a check-then-insert.

## Emits

`DeliveryJobCreated`, `DeliveryAccepted`, `DeliveryOutForDelivery`, `DeliveryAttempted`,
`DeliveryCompleted`, `DeliveryFailed`, `DeliveryProofCaptured`.

Consumers: [shipment](shipment.md) for the status transition, [cod](cod.md) for collection,
[notification](notification.md) for the recipient, [tracking](tracking.md) for the timeline.

## Must not touch

`rider` tables, `shipment` tables, `cod` tables. It holds `riderId`, `shipmentId`, and an
outcome. It does not read COD records — it emits an event and [cod](cod.md) owns the money.

---

Related: [shipment](shipment.md) · [cod](cod.md) · [returns](returns.md) ·
[rider](rider.md)
