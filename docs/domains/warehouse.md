# warehouse

Optional for MVP, part of the complete product. Deferred until a merchant actually needs
fulfilment rather than delivery.

---

## Owns

`warehouse` schema: `warehouses`, `zones`, `bins`, `inventory_items`, `stock_movements`,
`inbound_orders`, `outbound_orders`.

## Entities

```
Warehouse → WarehouseZone → Bin → InventoryItem
                                  ↑
                          StockMovement (append-only)
```

## Workflow

```
Merchant inventory → Warehouse → Storage → Order → Pick → Pack → Ship
```

## Rules

1. **Stock is never set.** It is derived from `stock_movements`. Every change is a movement row;
   the balance is a sum. Same principle as the ledger, for the same reason.
2. **Movements are append-only.** Corrections are reversing movements.
3. **Bin capacity is enforced**, or a warehouse's inventory location is fiction.
4. **Stock is never negative.** Enforced by a database constraint, not by application logic that
   can be bypassed by a migration or a manual fix.
5. **Picking is idempotent-keyed**, like every other physical action. Picking the same item twice
   on a flaky connection must not decrement twice.

## Packaging

Modelled as a separate operational domain rather than a shipment attribute, because packaging
has its own workflow, materials, capacity, and fees:

`PackagingOrder` · `PackagingMaterial` · `PackagingJob` · `PackagingFee`

Materials: envelope · small box · medium box · large box · fragile · custom.

A merchant paying a per-parcel packaging fee needs it to be a first-class chargeable service with
its own record — not a string on a shipment. [pricing](pricing.md) prices it; this module
performs it.

## Why it is deferred

Warehousing is a different business with a different lifecycle from delivery. Building it before
delivery works adds a domain that competes for attention with the one that proves the
architecture. The trigger is a merchant needing fulfilment, not delivery.

First extraction candidate along with tracking and analytics — genuinely different workload,
scale, and possibly lifecycle. See
[../architecture/extraction.md](../architecture/extraction.md).

---

Related: [pricing](pricing.md) · [shipment](shipment.md) · [hub](hub.md)
