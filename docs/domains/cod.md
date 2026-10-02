# cod

Cash collected by a third party, owed to a merchant. Phase 3.

---

## Owns

`cod` schema: `records`, `collections`, `reconciliation_runs`, `exceptions`.

## Lifecycle

```
COD_EXPECTED → COD_COLLECTED → COD_RECONCILED → COD_PAYABLE
            → SETTLEMENT_CREATED → SETTLED
```

Failures: `COLLECTION_FAILED` · `PARTIAL_COLLECTION` · `RECONCILIATION_EXCEPTION` ·
`SETTLEMENT_HOLD`.

## Rules

1. **Money is integer minor units plus currency.** `125050` poisha. Never a float. Columns are
   `bigint`. See [../architecture/money-and-ledger.md](../architecture/money-and-ledger.md).
2. **Collection is idempotency-keyed.** A rider on a flaky connection collecting twice must not
   produce two collections. This is the highest-value idempotency requirement in the product: it
   is the one that loses money.
3. **Partial collection is a first-class outcome**, not an error. Riders hand back short all the
   time. `125000` collected against `125050` expected is `PARTIAL_COLLECTION` — recorded,
   reconciled, and settled at the collected amount, with the shortfall visible.
4. **Reconciliation mismatches block, they never auto-correct.** See below.
5. **COD is expected at creation**, from the frozen quote. Changing the expected amount after
   collection is a ledger correction, not an update.

## Partial collection

```
expected  125050
collected 125000
shortfall    50   →  PARTIAL_COLLECTION
```

The merchant is settled on 125000. The 50 is recorded and reported. Nobody reconciles this by
hand, and nobody invents the missing 50.

## Reconciliation

Compare the physical record (what riders reported) against the COD records.

```
match     → COD_RECONCILED
mismatch  → RECONCILIATION_EXCEPTION → blocks settlement
```

**A mismatch never auto-corrects.** It raises a visible exception that operations resolves. An
auto-corrected discrepancy is a merchant quietly losing money, discovered weeks later when the
bank balance does not match the portal.

This is the single most important behaviour in the finance domain. Everything else can be
optimised; this cannot.

## Settlement

`COD_PAYABLE` → `SETTLEMENT_CREATED` → `SETTLED`, driven by [finance](finance.md). COD owns the
cash record; finance owns the money movement. The boundary is deliberate — a COD record and a
ledger entry are different facts, and conflating them makes reconciliation impossible.

## The expected amount comes from pricing

`COD_EXPECTED` is set at shipment creation from the frozen quote. It is a **promise**, not a
record of what happened. The gap between promise and collection is precisely what reconciliation
measures — which is why it must not be overwritten when collection differs.

## Must not touch

`finance` ledger entries (it emits events; finance writes the ledger),
`shipment` tables, `rider` tables.

## Emits

`CODCollected`, `CODCollectionFailed`, `CODPartialCollection`, `CODReconciled`,
`CODReconciliationException`, `CODPayable`.

---

Related: [finance](finance.md) · [delivery](delivery.md) · [returns](returns.md) ·
[../architecture/money-and-ledger.md](../architecture/money-and-ledger.md)
