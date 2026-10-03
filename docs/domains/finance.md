# finance

The ledger, balances, and settlements. Phase 3.

---

## Owns

`finance` schema: `accounts`, `ledger_entries`, `settlements`, `settlement_items`,
`settlement_batches`, `settlement_adjustments`, `provider_transactions`.

## Rules

1. **There is no `merchant.balance` column.** Balance is `SUM(direction * amount_minor)` over
   ledger entries. Every figure the merchant sees is derived.
2. **The ledger is append-only.** Corrections are compensating entries. `REVOKE UPDATE, DELETE`
   at the database level, not just in review.
3. **Money is integer minor units plus currency.** `bigint` columns, integer arithmetic, no
   floats anywhere including tests.
4. **A settlement is a frozen view of ledger entries**, not a recalculation. If a late COD
   arrives after approval, it lands in the _next_ settlement. An approved settlement is a
   contract.
5. **Approval is idempotency-keyed, permission-checked, and audited.** It moves real money, so
   it is guarded three ways.
6. **Every entry references its source** — `reference_type` + `reference_id`. An entry nobody
   can trace to a shipment or a COD record is unauditable money.

## Settlement

```
delivered shipments → COD reconciliation → merchant payable → settlement batch
                    → approval → payment initiated → payment confirmed → settled
```

```
Settlement #SET-001
  shipments         125
  COD collected     ৳185,500
  delivery fees     ৳12,500
  COD fees          ৳1,855
  adjustments       −৳300
  net payable       ৳170,845
```

Every figure derives from entries. See
[../architecture/money-and-ledger.md](../architecture/money-and-ledger.md) for the full model
and the remainder-allocation rule that keeps the total exact.

## Merchant balance

Available · pending COD · pending settlement · total delivered · total fees · total adjustments.

All derived from the ledger. Where a slow, a **projection** may be cached — but it must be
rebuildable and never authoritative. A counter that drifts has no way to tell how far.

## Payment providers

```ts
interface PaymentProvider {
  initiate(request: PaymentRequest): Promise<Payment>;
  verify(reference: string): Promise<Payment>;
}
```

Bank, mobile financial service, mock. Implementations in `finance/provider/`, importing nothing
from the domain. ZipZap is not a payment processor — the interface exists so providers can change
without the domain noticing.

The mock is the default in development, and the reason the interface is worth having.

## Consumes

`CODCollected`, `CODReconciled`, `ShipmentDelivered`, `ReturnCompleted` — each writes ledger
entries. Consumers are idempotent: a replayed event must not double-post an entry.

## Must not touch

`cod` tables, `shipment` tables, `merchant` tables. It reacts to events. It is the module that
turns facts from other modules into money, and it is the only one that writes money.

---

Related: [cod](cod.md) · [pricing](pricing.md) · [merchant](merchant.md) ·
[../architecture/money-and-ledger.md](../architecture/money-and-ledger.md)
