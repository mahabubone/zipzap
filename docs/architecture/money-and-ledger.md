# Money and the ledger

Integer minor units. An append-only ledger. Everything else is derived.

---

## Money

```ts
type Currency = 'BDT';

interface Money {
  readonly amountMinor: number; // integer. 125050
  readonly currency: Currency;
}
```

`৳1,250.50` is `125050` poisha. `1250.50` is not a number we ever store.

Non-negotiable:

- **Never a float.** Not in the database, not in a DTO, not in a test, not in a log line.
- **Never `parseFloat`, `toFixed`, or `*` on money.** Only integer addition, subtraction,
  multiplication by an integer quantity, and division with an explicit remainder.
- **Never `Math.round`.** If a calculation produces a fraction, the division is wrong or the
  business rule must state where the remainder goes.
- **Never a bare number.** A `Money` always carries its currency. Adding across currencies is a
  bug, not a conversion.

```ts
// ✅
const fee = add(base, multiply(codFee, quantity));

// ❌
const fee = base + codFee * 0.018;
```

Rounding is a business decision, always explicit:

```ts
/** Split 100 poisha 60/40 without losing a single unit. */
function allocate(amountMinor: number, ...weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => Math.floor((amountMinor * w) / total));
  const remainder = amountMinor - shares.reduce((a, b) => a + b, 0);
  shares[0] += remainder; // the remainder goes to the first share, by policy
  return shares;
}
```

A settlement that loses 3 poisha per shipment across 10,000 shipments is a ৳30,000 discrepancy
that nobody finds for a month. Allocate the remainder deliberately.

## Storage

```sql
amount_minor bigint    NOT NULL,
currency     char(3)   NOT NULL,
```

`bigint`, not `numeric` — we never divide to sub-minor precision, and integer maths is exact and
indexable. `pg` returns `bigint` as a JS `string` by default; configure a parser so it arrives
as a number. BDT amounts fit comfortably inside `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991
poisha ≈ ৳90 trillion), so this is safe — but the parser must be explicit, never accidental.

One currency column per row, not a currency table. The row is the unit of accounting.

## The ledger

There is no mutable `merchant.balance` column. Balance is the sum of entries, derived.

```
merchant account
  + delivery fee charged
  + COD collected on the merchant's behalf
  - return fee
  - COD service fee
  ± adjustment
  = merchant balance
```

Two accounts per relationship: what the platform owes the merchant, and what the merchant owes
the platform. Every entry moves value between them. A debit and a credit, always equal.

```sql
CREATE TABLE finance.ledger_entries (
  id            bigserial PRIMARY KEY,
  account_id    uuid        NOT NULL,
  entry_type    text        NOT NULL,   -- DELIVERY_FEE | COD_COLLECTED | COD_FEE | RETURN_FEE | ADJUSTMENT | ...
  direction     smallint    NOT NULL,   -- +1 | -1
  amount_minor  bigint      NOT NULL CHECK (amount_minor > 0),
  currency      char(3)     NOT NULL,
  reference_type text       NOT NULL,   -- SHIPMENT | COD_RECORD | SETTLEMENT | ADJUSTMENT
  reference_id  uuid        NOT NULL,
  memo          text,
  occurred_at   timestamptz NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now()
);
```

`amount_minor > 0` with a separate `direction` means the sign is never ambiguous, never derived
from a value that could be zero, and never a sign-flip bug in a sum.

`recorded_at` is distinct from `occurred_at` because they genuinely differ: a COD collected
yesterday is reconciled today. Audit needs both.

## Append-only

Entries are never updated or deleted. Corrections are compensating entries:

```
original:    COD_COLLECTED  +125050   (shipment X)
correction:  ADJUSTMENT     -5000     (short collection, note: "rider reported ৳50 short")
```

The wrong row stays visible. The correction explains it. The sum is correct.

A ledger that silently rewrites history cannot answer "what happened", and a ledger that cannot
answer that cannot be used to settle a dispute — which is the entire purpose.

`REVOKE UPDATE, DELETE ON finance.ledger_entries FROM zipzap_app;`

## Derived balances

```sql
SELECT account_id,
       SUM(direction * amount_minor) AS balance_minor
FROM finance.ledger_entries
WHERE account_id = $1
GROUP BY account_id;
```

Balance, available balance, pending COD, and pending settlement are all queries or projections
over the ledger — never stored counters.

Why: a counter drifts. A retry, a rolled-back projection, a manual fix, and the number is
permanently wrong with no way to tell from how far. A sum over append-only rows is either right
or you have lost rows, which is loud.

Slow? Then you have too many entries and need an index or a projection — not a mutable column.
A projection is fine as a cache. It must be rebuildable and never authoritative.

## Reconciliation

Reconciliation is the process that compares what the physical world says against what the
ledger says, and raises an exception when they disagree.

```
rider reported collecting ৳1,250.50
COD record says COD_COLLECTED 125050        ✓
```

```
rider reported collecting ৳1,200.00
COD record says COD_COLLECTED 125050        ✗
  → PARTIAL_COLLECTION
  → RECONCILIATION_EXCEPTION
  → compensating entry for 5,050
  → exception visible to operations, blocking settlement
```

Never auto-correct a mismatch. An exception that blocks settlement is the product working. An
auto-corrected discrepancy is a merchant quietly losing money.

## Settlement

```
delivered shipments
  → COD reconciliation
  → merchant payable
  → settlement batch
  → approval
  → payment initiated
  → payment confirmed
  → settled
```

```
Settlement #SET-001
  shipments          125
  COD collected      ৳185,500
  delivery fees      ৳12,500
  COD fees           ৳1,855
  adjustments        −৳300
  net payable        ৳170,845
```

Every figure derives from ledger entries. The settlement is a frozen view of them, not a
recalculation. If a late COD arrives after approval, it lands in the _next_ settlement — the
approved one is a contract, and contracts do not change.

Settlement approval requires the `settlement:approve` permission, is idempotent-keyed, and writes
an audit event. It moves real money; that is the whole reason it is guarded three ways.

## Payment providers

ZipZap is not a payment processor. Providers sit behind one interface:

```ts
interface PaymentProvider {
  initiate(request: PaymentRequest): Promise<Payment>;
  verify(reference: string): Promise<Payment>;
}
```

Bank, mobile financial service, or mock. Implementations live in `finance/infrastructure/` and
import nothing from the domain. The domain does not know which provider exists.

The mock is the default in development. Real providers arrive in a later phase, behind the same
interface — which is the entire reason the interface exists.

## Pricing

Pricing is its own module with its own schema. Prices are configuration, never constants in a
handler.

```
base delivery fee
  + weight surcharge
  + COD fee
  + remote area fee
  + special handling
  + packaging
  + VAT / tax
  − merchant discount
```

Resolution order: default pricing → merchant pricing profile → volume discount → custom contract.

A quote is **versioned**, and a shipment stores the `pricing_version` used when it was created.
Without that, a price dispute months later cannot be answered, because the rule may have changed
four times since. The quote is the contract.

## Rules that are not negotiable

1. No floats, anywhere, including tests and logs.
2. Every amount carries a currency.
3. Rounding and remainder allocation are explicit and tested.
4. The ledger is append-only; corrections are compensating entries.
5. Balances are derived; no stored counters.
6. Reconciliation mismatches block, they never auto-correct.
7. Every settlement is idempotent-keyed and audited.
8. An approved settlement is immutable; late money goes to the next one.
