# rider

The people doing the work, and the software choosing their next job. Phase 2.

---

## Owns

`rider` schema: `riders`, `profiles`, `devices`, `availability`, `assignments`, `performance`.

## State

```
OFFLINE ⇄ AVAILABLE → ON_PICKUP / ON_DELIVERY
                   → ON_BREAK
                   → SUSPENDED
```

`ON_BREAK` is separate from `OFFLINE` on purpose: a break is a decision, absence is not, and they
mean different things to dispatch and to payroll.

## Assignment

Inputs: distance · service zone · current location · capacity · current workload · availability ·
vehicle type · priority · SLA.

```
filter eligible riders → calculate distance → filter capacity
  → score → select → create assignment
```

**This is not claimed to be an optimal routing algorithm.** The first implementation is
deterministic and explainable.

Explainable matters more than optimal here, and it is worth being explicit about why. When a
customer asks why their parcel went the long way, operations need an answer they can read. A
system that optimises slightly better but cannot explain itself creates support tickets that cost
more than the fuel it saved.

Ties break on a stable key (`rider_id`), never on iteration order. Non-deterministic assignment
is non-debuggable assignment.

## Rules

1. **One active assignment per rider per job.** Reassignment closes and records the previous.
2. **Availability is explicit**, updated by the rider or inferred from heartbeat expiry — never
   assumed.
3. **Location updates are high-frequency and short-lived.** They are not history; they are
   current state. Retention is short and they live in Redis as well as Postgres.
4. **Performance metrics are projections**, never written on the hot path of a scan.
5. **A device is revocable.** Revoking it cuts off offline sync from a lost phone.

## Offline sync

A rider on a bad connection queues commands locally. Every command carries `device_id`,
`command_id`, `created_at`, `operation`, `payload`.

The server dedupes on `command_id`. A scan performed twice on a flaky connection must still be
one scan — this is the hardest consistency requirement in the product and the reason
[../api/idempotency.md](../api/idempotency.md) is not optional.

Replay is ordered by `created_at`, and a command that is no longer valid (the shipment was
cancelled while the device was offline) is rejected explicitly rather than dropped. Silence
leaves the rider believing something happened that did not.

## Emits

`RiderAssigned`, `RiderUnassigned`, `RiderAvailabilityChanged`, `RiderLocationUpdated`,
`RiderSuspended`, `RiderOfflineSyncCompleted`.

## Must not touch

`delivery` tables, `pickup` tables, `shipment` tables. It holds identifiers and its own
assignment records.

---

Related: [pickup](pickup.md) · [delivery](delivery.md) · [hub](hub.md) ·
[../api/idempotency.md](../api/idempotency.md)
