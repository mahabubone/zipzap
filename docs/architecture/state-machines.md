# State machines

A status column is never `UPDATE`d directly. It changes only through a transition that validates
the current state. This is rule 6 in [../AGENTS.md](../AGENTS.md) and the single most valuable
invariant in the product.

---

## Why

A parcel's status is not a field. It is the output of a hundred transitions made by riders,
hub operators, and automated jobs that may double up, arrive late, or arrive out of order.
Without a validated machine the state is whatever the last writer said.

The failure is not a crash. It is a parcel marked `DELIVERED` that is sitting on a hub shelf, a
COD collected against a shipment nobody delivered, a merchant settlement containing a parcel that
does not exist. Those are discovered weeks later, during reconciliation.

So: the transition table is data, in the domain, unit-tested, framework-free.

---

## Shipment

```
DRAFT
  ↓
CREATED
  ↓
PICKUP_REQUESTED
  ↓
PICKUP_ASSIGNED
  ↓
PICKED_UP
  ↓
AT_ORIGIN_HUB
  ↓
SORTING
  ↓
DISPATCHED
  ↓
IN_TRANSIT
  ↓
AT_DESTINATION_HUB
  ↓
OUT_FOR_DELIVERY
  ↓
DELIVERED
```

Allowed transitions:

| From                 | To                                                 |
| -------------------- | -------------------------------------------------- |
| `DRAFT`              | `CREATED`, `CANCELLED`                             |
| `CREATED`            | `PICKUP_REQUESTED`, `CANCELLED`                    |
| `PICKUP_REQUESTED`   | `PICKUP_ASSIGNED`, `CANCELLED`                     |
| `PICKUP_ASSIGNED`    | `PICKED_UP`, `CANCELLED`                           |
| `PICKED_UP`          | `AT_ORIGIN_HUB`, `EXCEPTION`                       |
| `AT_ORIGIN_HUB`      | `SORTING`, `EXCEPTION`                             |
| `SORTING`            | `DISPATCHED`, `EXCEPTION`                          |
| `DISPATCHED`         | `IN_TRANSIT`, `EXCEPTION`                          |
| `IN_TRANSIT`         | `AT_DESTINATION_HUB`, `EXCEPTION`, `LOST`          |
| `AT_DESTINATION_HUB` | `OUT_FOR_DELIVERY`, `EXCEPTION`                    |
| `OUT_FOR_DELIVERY`   | `DELIVERED`, `DELIVERY_FAILED`, `RETURN_INITIATED` |
| `DELIVERY_FAILED`    | `RETRY_SCHEDULED`, `RETURN_INITIATED`              |
| `RETRY_SCHEDULED`    | `OUT_FOR_DELIVERY`, `RETURN_INITIATED`             |

Administrative states reachable from most of the above: `ON_HOLD`, `CANCELLED`, `LOST`,
`DAMAGED`, `EXCEPTION`.

Return is a parallel lifecycle on the same shipment, never a second parcel:

```
RETURN_REQUESTED → RETURN_APPROVED → RETURN_INITIATED → RETURN_IN_TRANSIT
                → RETURN_AT_HUB → RETURN_OUT_FOR_DELIVERY → RETURNED
```

Merged 2026-10-04 with [returns.md](../domains/returns.md): the decision half
(REQUEST → APPROVE/REJECT) plus the custody legs. The machine in
`rules/returns.ts` is the source.

`RETURN_INITIATED` and `DELIVERED` are both terminal for the forward path — a shipment that was
delivered and then returned reached `DELIVERED` first. There is no backwards transition. History
is a chain of forward moves.

`ON_HOLD` is the exception: it is resumable, and it records the state it interrupted so
`release` returns the shipment exactly where it was.

## Other machines

| Machine          | Lifecycle                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------- |
| **Merchant**     | `APPLIED → UNDER_REVIEW → VERIFIED → ACTIVE`, `ACTIVE ⇄ SUSPENDED`                           |
| **COD**          | `COD_EXPECTED → COD_COLLECTED → COD_RECONCILED → COD_PAYABLE → SETTLEMENT_CREATED → SETTLED` |
| **Manifest**     | `DRAFT → SEALED → DISPATCHED → RECEIVED → RECONCILED`                                        |
| **Rider**        | `OFFLINE ⇄ AVAILABLE → ON_PICKUP / ON_DELIVERY`, `ON_BREAK`, `SUSPENDED`                     |
| **Delivery job** | `CREATED → ASSIGNED → ACCEPTED → OUT_FOR_DELIVERY → ATTEMPTED → DELIVERED \| FAILED`         |
| **Return**       | `RETURN_REQUESTED → RETURN_APPROVED → RETURN_INITIATED → … → RETURNED`                       |
| **Settlement**   | `CREATED → APPROVED → PAYMENT_INITIATED → PAYMENT_CONFIRMED → SETTLED`                       |

COD failures: `COLLECTION_FAILED`, `PARTIAL_COLLECTION`, `RECONCILIATION_EXCEPTION`,
`SETTLEMENT_HOLD`.

A shipment missing from a sealed manifest becomes an exception at reconciliation. Silence is
never the answer.

## In code

The shape, not the implementation:

```ts
// shipment/rules/state-machine.ts — no @nestjs, no typeorm
const TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  CREATED: ['PICKUP_REQUESTED', 'CANCELLED'],
  /* … */
};

export function assertTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}
```

`assertTransition` throws. It never returns a boolean — a caller that forgets to check a boolean
will happily proceed, and the caller that forgets to catch a throw fails loudly.

## Concurrency

Two riders scan the same parcel. Both read `OUT_FOR_DELIVERY`. Both try to transition.

```
BEGIN
  SELECT ... FROM shipment.shipments WHERE id = $1 FOR UPDATE;   -- serialises
  assertTransition(current, next);                                -- second one throws
  UPDATE ...
  INSERT INTO tracking.events ...
  INSERT INTO system.outbox_events ...
COMMIT
```

The row lock makes the second transition see the committed state and fail. Every transition
takes the lock. This is the reason a duplicate scan cannot double-advance a shipment.

## Failure is a branch, not an error

`DELIVERY_FAILED` is not an exception — it is a normal outcome of a delivery operation, with a
structured reason (`CUSTOMER_UNAVAILABLE`, `WRONG_ADDRESS`, `PHONE_UNREACHABLE`,
`CUSTOMER_REFUSED`, `ADDRESS_INCOMPLETE`, `PAYMENT_ISSUE`, `DAMAGED_PACKAGE`, `WEATHER`,
`OPERATIONAL_EXCEPTION`) that drives the next step: retry, reschedule, contact the merchant,
return, or escalate.

`EXCEPTION` is the operational catch-all for "this should not have happened" — a manifest that
did not reconcile, a hub record that does not exist. It is alertable, and it never silently
resolves itself.

## Testing

The transition table is a pure function over enums. Test it exhaustively:

- every `from` × every `to` pair — legal transitions pass, all others throw
- a duplicate transition is rejected
- `release` from `ON_HOLD` returns the recorded prior state
- a return can only start from a state that permits it

This is the test that pays for itself. It is cheap, it is exhaustive, and it catches the class of
bug that otherwise surfaces as a financial dispute.
