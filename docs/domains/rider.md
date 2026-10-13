# rider

The people doing the work, and the software choosing their next job. Phase 2.

---

## Owns

`rider` schema: `riders`, `profiles`, `devices`, `availability`, `assignments`, `performance`,
`command_queue`.

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

A rider on a bad connection queues mutating commands locally and replays them on reconnection.
The server owns the authoritative order: each queued command has `device_sequence` (the device's
monotonic clock, unique per rider) and `created_at`; pulls return pending commands ordered by
`created_at` / `device_sequence` in a capped window (`RIDER_COMMAND_QUEUE_CAP`, default 100) that
reports `capWarning` once the pending count passes 90%.

Every command carries `expected_state` — the aggregate snapshot at enqueue time. During ack the
server compares it with the live rider state:

```
expected_state matches  →  mark acknowledged_at, emit RiderCommandDelivered
expected_state stale    →  mark rejected_at + rejection_reason, emit RiderCommandRejected
already acknowledged    →  replay the recorded outcome (already_delivered)
already rejected        →  replay the recorded outcome (already_rejected)
```

A mismatch is a **recorded rejection with a reason**, never a silent drop — silence leaves the
rider believing something happened that did not. Delivery or rejection is append-only:
`acknowledged_at` or `rejected_at` (never both) plus the reason. A row with neither set is
`PENDING`; the pending window index keeps pulls cheap.

Idempotency-Key is mandatory on the ack (`scope: rider.sync-ack`): a duplicate key replays the
stored response byte-for-byte; a key reused against a different body is rejected with
`INVALID_IDEMPOTENCY_KEY`. This makes a retried confirm indistinguishable from a successful
first attempt. See [ADR-0010](../ADR/0010-idempotency.md).

### The other direction: a device pushing its own day back

Everything above describes ops queueing work **for** a rider. The half that matters most is the
rider's own commands going the other way, and until 2026-10-09 there was no route for it:
`enqueue()` existed, was fully implemented, and had no caller outside tests. The queue was
unreachable in production while its tests passed.

`POST /v1/riders/:riderId/sync/replay` is that route. Three properties, each load-bearing:

1. **Ordered by the device's `created_at`**, tie-broken by `device_sequence`. The server cannot know
   when the rider pressed the button.
2. **Exactly once on `(rider_id, device_sequence)`**, via `ON CONFLICT DO NOTHING`. A re-sent batch
   returns `duplicate` per command carrying the _original_ outcome, so a phone that reconnects twice
   converges on one truth instead of applying forty scans twice.
3. **One transaction for the whole batch, cap checked up front.** A batch that would overflow is
   refused _entirely_ with 409 `COMMAND_QUEUE_FULL`. Applying 100 and refusing the 101st would lose
   the rest — the exact silent loss ADR-0012 exists to prevent.

Two command types, two validators. `zipzap.rider.command` checks the **rider's** status. The new
`zipzap.rider.delivery` checks the **shipment's**, reading it through `SHIPMENT_LOOKUP.currentStatus`
rather than the shipment connection (rule 2). That second validator is what makes an offline day safe
rather than merely deferred: a parcel cancelled while the phone was in a pocket comes back
`rejected` with `expected status OUT_FOR_DELIVERY, shipment is CANCELLED`, recorded on the row and
never applied over a state the rider never observed.

### `rider:sync`, and who holds it

The rider endpoints were guarded by `ApiKeyGuard` alone — there was no `rider:*` scope for a guard to
name, so any authenticated principal could read a named rider's queue, which carries COD amounts.
`rider:sync` is now in `PLATFORM_SCOPES`, so it is withheld from merchant roles by the same
subtraction that withholds `hub:scan`. A hub is our network partner and a merchant is our client;
neither is a tenant of the other, and neither should be able to read a rider's day.

### The device half

`apps/mobile-rider/src/offline/command-queue.ts`, framework-free so it is provable without a
simulator. `nextSequence` is persisted and monotonic — a restart must never reissue one, because that
number is half the dedupe key. The cap warns at 90% and refuses at 100%; refusing the hundred-and-
first is the safe direction, because losing a scan the rider was told was accepted is not recoverable
by anyone. A rejection is kept with its reason rather than retried: retrying a cancelled parcel would
re-refuse forever and hide a real problem behind a spinner.

**There is no Expo app yet.** No screens, no proof-of-delivery UI. That is a deliberate order, not an
oversight: the queue is the part that can silently lose a day, and a screen asserting "synced" over a
queue without exact-once would be a lie with a spinner.

## KPI

Rider utilisation — fraction of capacity in use — is measured with the assignment scoring, then
used to optimise it.

- **Measure**: `loadFactor = activeJobs / capacity` per rider; `poolLoad` aggregates across the
  assignable pool (`totalCapacity`, `inUseCapacity`, `meanLoadFactor`, `maxLoadFactor`, `minLoadFactor`).
- **Surface**: read-only `GET /v1/riders/:riderId/utilisation` and `GET /v1/riders/pool-utilisation`.
- **Record**: every assignment records `poolLoadBefore` (pool state at scoring time) and
  `chosenLoadFactorAfter` (the chosen rider's load after the assignment) — the before/after audit
  trail for the exit gate.
- **Optimise**: the scoring bonus (`SPARE_CAPACITY_BONUS = 40`) rewards spare capacity, so dispatch
  spreads work instead of piling it on the nearest rider. It is subordinate to refusals and
  capacity-exclusion, and the existing ordering rules are unchanged.

## Emits

`RiderAssigned`, `RiderUnassigned`, `RiderAvailabilityChanged`, `RiderLocationUpdated`,
`RiderSuspended`, `RiderOfflineSyncCompleted`.

## Must not touch

`delivery` tables, `pickup` tables, `shipment` tables. It holds identifiers and its own
assignment records.

---

Related: [pickup](pickup.md) · [delivery](delivery.md) · [hub](hub.md) ·
[../api/idempotency.md](../api/idempotency.md)
