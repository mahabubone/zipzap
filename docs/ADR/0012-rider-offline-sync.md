# ADR-0012: Offline rider mode with per-command idempotency

**Status** accepted · 2026-10-02

## Context

Riders work in basements, lifts, rural roads, and congested Dhaka streets. Connectivity fails
constantly and for minutes at a time.

A rider who scans a parcel and does not see confirmation will scan it again — correctly, from
their point of view. If the first scan actually succeeded, the second is a duplicate scan, a
duplicate custody record, and a parcel that appears to move twice.

This is the hardest consistency requirement in the product. It is not an edge case, and it cannot
be handled by asking riders to be more careful.

## Decision

**The rider app queues commands locally and syncs when the network returns. Every command
carries an idempotency key.**

```ts
interface OfflineCommand {
  deviceId: string;
  commandId: string; // idempotency key
  createdAt: string;
  operation: 'SCAN' | 'DELIVER' | 'COLLECT_COD' | 'REPORT_EXCEPTION';
  payload: unknown;
}
```

The server dedupes on `commandId`, per
[ADR-0010](0010-idempotency.md). Replay is ordered by `createdAt`.

**As built (2026-10-09), three parts of this shape changed and the reasoning survived:**

| Decided                               | Built                                                | Why                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deviceId` on every command           | `(rider_id, device_sequence)`                        | The rider in the path already names the device's owner, so a separate id was redundant for dedupe. A `rider.devices` table is still owed — "revoking it cuts off sync from a lost phone" is **not implemented**, and a lost phone can still sync.                     |
| `commandId` as the idempotency key    | `device_sequence`, a device-minted monotonic integer | Strictly stronger: it survives the device losing a key, so a factory-reset phone still cannot apply a scan twice.                                                                                                                                                     |
| `operation: 'SCAN' \| 'DELIVER' \| …` | `commandType` + a per-type validator registry        | The queue does not need to know what a delivery means. `zipzap.rider.delivery` is validated against the **shipment's** status, which is what makes the "cancelled while offline" rejection below actually possible — a rider-status check alone would have passed it. |

The decision's substance is intact and proven: replay is ordered by the device's `createdAt`, an
invalid command is rejected explicitly with a reason, and server-side state still validates. Only the
wire's spelling moved. See [../domains/rider.md](../domains/rider.md).

Supporting decisions:

- **An invalid command is rejected explicitly** and reported back to the device. A shipment
  cancelled while the device was offline must not be silently dropped.
- **A `device_id` is a revocable entity.** Revoking it cuts off sync from a lost phone.
- **Server-side state transition still validates.** An offline-delayed scan of a cancelled
  shipment is rejected, not applied retroactively.
- **The app shows sync state visibly.** A rider must be able to see that work is queued.

## Consequences

### Positive

- Connectivity loss does not stop work, which is the whole point.
- Duplicate scans cannot corrupt the custody history.
- A rider can work a full route in airplane mode.
- Explicit rejection means the device and the server agree on what happened.

### Negative

- **The app must be genuinely local-first**, not "queue the last few things". Every mutating
  action goes through the queue.
- Conflict resolution is required and cannot be avoided: the world changed while the device was
  offline.
- Local storage needs its own durability story — a cleared cache loses queued scans.
- The sync protocol is a second API surface with its own contract and its own tests.
- Storage grows unboundedly if a device stays offline; it needs a cap and an alert.

### The failure mode worth naming

Silently dropping an invalid command leaves the rider believing a scan succeeded that did not.
They will tell the merchant, the merchant will open a ticket, and the parcel will be
unaccounted for.

**Explicit rejection is what makes this safe.** That is the difference between an offline mode
that works and one that quietly loses parcels.

## Alternatives considered

**Require connectivity for scans; block offline.** Rejected: it does not solve the problem, it
declines to. Riders in coverage gaps would simply not scan, which is a worse version of the same
data loss.

**Client-generated UUID as the idempotency key.** This is the chosen design. The alternative —
hashing the payload — is rejected because two genuinely identical scans are legitimate events
and would collide.

**Last-write-wins on conflict.** Rejected: loses data silently. A scan that happened is a fact
regardless of whether the server agreed.

**Server assigns the timestamp on sync.** Rejected: every offline action would appear to have
happened at reconnection, destroying the operational record. `createdAt` from the device is the
truth, with a server-side `recorded_at` alongside it.
