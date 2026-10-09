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

## The correction window

A review of a COD mismatch clears the merchant's settlement block **in the transaction that emits
`CODReconciled`**, but the correcting `ADJUSTMENT` row is written afterwards, by the consumer
above. So for as long as that hop takes, the merchant is unblocked and the ledger is still wrong.

A freeze inside that window takes the over-collected row and not its correction, and pays the
difference out of the merchant's own pocket. Measured live, not theorised: the review committed at
`.283`, the freeze ran at `.324`, the correction landed at `.644` — **320ms**, and an operator
working a queue of mismatches would hit it every time.

So `CreateSettlementService` refuses the freeze while any reviewed-and-disagreeing record is still
missing its `ADJUSTMENT`, and says so rather than failing silently:

> 1 reviewed collection(s) are still being corrected in the ledger. Retry in a moment.

Closing it needs both halves of a question neither module can answer alone — **cod** knows which
records were reviewed and disagreed, **finance** knows which corrections reached the ledger. cod
answers through `COD_LOOKUP.reviewedMismatches` (rule 2: never a join on `cod.records`), finance
checks with `adjustedRecordIds`. `correction-window.spec.ts` covers the ordering, including that an
unreviewed exception is still reported first — an operator should never be sent to audit a row that
is already correct.

**Three money bugs came out of the Stage 2 proof, and all three were ordering, not arithmetic.**
The rules were right in each case; the sequence was not. They are written up in
`docs/product/competition/plan.md` because the shape recurs: a freeze that ignores a correction, a
freeze that outruns one, and a block that never lifts.

## Reading COD across the boundary

finance never opens `cod`. It buys two reads from `CodLookup`:

- `blocksFor(merchantId)` — counts of the statuses standing between this merchant and a payout. A
  map, not a number, because "blocked" is more than one situation and an operator has to be told
  which. Only `RECONCILIATION_EXCEPTION` and `SETTLEMENT_HOLD` block.
- `reviewedMismatches(merchantId)` — the correction window, above.

`cod/rules/cod.ts` owns `blocksSettlement`; finance only enforces it. `SETTLEMENT_BLOCKED_STATUSES`
is derived from the function so a new blocking state cannot be added without appearing in review.

## Must not touch

`cod` tables, `shipment` tables, `merchant` tables. It reacts to events. It is the module that
turns facts from other modules into money, and it is the only one that writes money.

---

Related: [cod](cod.md) · [pricing](pricing.md) · [merchant](merchant.md) ·
[../architecture/money-and-ledger.md](../architecture/money-and-ledger.md)
