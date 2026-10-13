# Idempotency

A retried mutation must do the same thing as the first attempt, not the same thing twice.

This is not an optimisation. Every merchant integration will retry on timeout, every rider will
rescan on a flaky connection, and every webhook will deliver more than once. The system is
assumed to receive duplicates.

## The header

```
Idempotency-Key: merchant-123-create-order-ABC-001
```

Mandatory on:

| Operation          | Consequence of a duplicate               |
| ------------------ | ---------------------------------------- |
| Shipment create    | double-charged, double parcel            |
| Bulk import        | 10,000 duplicate shipments               |
| COD collect        | **money created from nothing**           |
| Delivery confirm   | two proofs, two deliveries               |
| Settlement approve | two payments                             |
| Rider offline sync | duplicate scans, corrupt custody history |

COD collect and settlement approve are the ones that lose real money. They are the reason the
header is mandatory rather than optional.

## Mechanism

```
INSERT INTO system.idempotency_keys (scope, key, request_hash, ...)
VALUES (…)
ON CONFLICT (scope, key) DO NOTHING
```

- **insert wins** → run the operation, store the response
- **conflict + same request hash** → return the stored response
- **conflict + different request hash** → `400 INVALID_IDEMPOTENCY_KEY`

The row is inserted **inside the operation's transaction**, so it commits or rolls back with the
work. A key recorded outside the transaction can survive a rollback and permanently block a
request that never actually happened.

## Store the response, not a flag

A `seen` boolean gives the client a 409 and no way to proceed. The client cannot know what
happened, and a merchant whose request timed out has no way to find out whether they now have
two parcels.

```sql
response_code int,
response_body jsonb,
```

Return the original response, byte for byte, with the same status code. A replayed request that
succeeds identically is indistinguishable from the first — which is the point.

## Hash the request body

Storing the request hash catches a client reusing a key for a different payload:

```
POST /v1/shipments   Idempotency-Key: abc   →  201, shipment 1
POST /v1/shipments   Idempotency-Key: abc   →  400 INVALID_IDEMPOTENCY_KEY
                     (different body)
```

That is a client bug, and silently returning the first response would hide it — the merchant
would believe their second parcel was created. Failing loudly is correct.

## Scope

The key is unique per `(scope, key)`, where scope is the operation class. Without it, a merchant
that happens to use `order-1` for both a pickup and a shipment collides.

The key is also scoped to the merchant. Two merchants using `order-1` are two different requests,
and one must never see the other's response.

## Concurrency

Two simultaneous requests with the same key: exactly one inserts, the other conflicts. The
loser must wait for or read the winner's response rather than running the operation anyway.

The unique constraint is the concurrency control. An application-level "check then insert" has a
race, and this is a race that creates duplicate shipments.

## Retention

Keys must outlive any plausible client retry window. Expired keys mean a late retry duplicates
work, so expiry is a correctness decision, not a housekeeping one.

Financial operations keep keys far longer than operational ones. A merchant disputing a COD
collection six weeks later must still be able to prove they collected once.

## Rider offline sync

The hardest case. Every queued command carries `device_id`, `command_id`, `created_at`,
`operation`, `payload`.

```ts
interface OfflineCommand {
  deviceId: string;
  commandId: string; // idempotency key
  createdAt: string;
  operation: 'SCAN' | 'DELIVER' | 'COLLECT_COD' | 'REPORT_EXCEPTION';
  payload: unknown;
}
```

Replay is ordered by `createdAt`. A command that is no longer valid — the shipment was cancelled
while the device was offline — is **rejected explicitly** and reported back to the device.

**What actually ships (`POST /v1/riders/:riderId/sync/replay`).** The `OfflineCommand` interface above
is the _decision_; the wire is:

```jsonc
{
  "commands": [
    {
      "deviceSequence": 41, // device-minted, monotonic, half the dedupe key
      "createdAt": "2026-10-09T11:04:00Z", // the DEVICE's clock — the server orders on this
      "commandType": "zipzap.rider.delivery",
      "payload": { "shipmentId": "…" },
      "expectedState": { "shipmentId": "…", "shipmentStatus": "OUT_FOR_DELIVERY" },
    },
  ],
}
```

The response rules each command by `kind`:

| `kind`      | Meaning                                                                        | Device action                                        |
| ----------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `applied`   | First time, valid.                                                             | Drop from pending.                                   |
| `rejected`  | First time, invalid. `reason` is human-readable.                               | Drop from pending, **show the reason**. Not retried. |
| `duplicate` | This `deviceSequence` was already submitted. `reason` says what happened then. | Drop from pending, reconcile.                        |

There is **no `deviceId` and no `commandId`**. `deviceSequence` is the key and it is minted on the
device — which is why a phone that loses its keys still cannot apply a scan twice, and why a
`rider.devices` revocation table is still owed before a lost phone can be cut off.

Silently dropping it leaves the rider believing a scan succeeded that did not. They will tell the
merchant, and the merchant will tell support, and the parcel will be unaccounted for.

---

Related: [errors.md](errors.md) · [../domains/rider.md](../domains/rider.md) ·
[../domains/cod.md](../domains/cod.md) · [../architecture/database.md](../architecture/database.md)
