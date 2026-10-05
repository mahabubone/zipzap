# returns

A parcel going backwards. Phase 2.

---

## Owns

`returns` schema: `requests`, `approvals`, `transitions`, `reasons`.

## Lifecycle

```
RETURN_REQUESTED → RETURN_APPROVED → RETURN_INITIATED → RETURN_IN_TRANSIT
                → RETURN_AT_HUB → RETURN_OUT_FOR_DELIVERY → RETURNED
```

Merged 2026-10-04: the decision half (REQUEST → APPROVE/REJECT) from this page, the
custody legs from [state-machines](../architecture/state-machines.md). `TO_MERCHANT`
was dropped — a status masquerading as a leg. The machine in `rules/returns.ts` is
the source; this page and the ROADMAP quote it.

The shipment walks the custody legs in lockstep: each `advance` also moves
`shipment.shipments.status` through `ShipmentAdvanceService` (injected contract — this
module never writes shipment tables). The request row waits at APPROVAL; the parcel must
be in a return-eligible state (delivered, refused, scheduled for retry) or the machine 409s.

## Reasons

`CUSTOMER_REFUSED` · `CUSTOMER_UNAVAILABLE` · `WRONG_ADDRESS` · `DAMAGED` ·
`MERCHANT_REQUEST` · `OTHER`

## Rules

1. **A return references the original shipment.** Never a second, unrelated parcel. Two
   disconnected records for one physical parcel is how inventory and money drift apart.
2. **Approval is explicit.** A return that auto-approves refunds money to a merchant without
   their agreement. Approval is a merchant decision with an audit trail.
3. **The forward lifecycle is never rewound.** A delivered-then-returned shipment reached
   `DELIVERED` first. History is a chain of forward moves; see
   [../architecture/state-machines.md](../architecture/state-machines.md#shipment).
4. **Financial consequences are compensating ledger entries**, written by
   [finance](finance.md) from events — never calculated twice in two modules.
5. **Returns have the same custody problem as delivery.** Scans at every handover, and the same
   offline-idempotency rules.

## Interaction with COD

The hard case: a shipment was delivered, COD was collected, and the parcel is now coming back.
The COD must be **reversed**, not merely marked returned.

```
COD_COLLECTED +125050
  → return approved
  → ADJUSTMENT -125050   (compensating entry, original row preserved)
```

Both rows remain visible. The merchant sees the collection and the reversal and can reconcile
them. Nothing is silently zeroed.

This is the clearest example of why the ledger is append-only — see
[../architecture/money-and-ledger.md](../architecture/money-and-ledger.md).

## Emits

`ReturnRequested`, `ReturnApproved`, `ReturnRejected`, `ReturnInitiated`,
`ReturnInTransit`, `ReturnAtHub`, `ReturnCompleted`.

## Must not touch

`shipment`, `finance`, `cod` tables. It holds identifiers and its own lifecycle. The shipment
status transition is requested through the shipment module; the financial reversal is
[finance](finance.md)'s response to an event.

---

Related: [shipment](shipment.md) · [delivery](delivery.md) · [finance](finance.md) ·
[cod](cod.md)
