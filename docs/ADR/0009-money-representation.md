# ADR-0009: Money as integer minor units

**Status** accepted · 2026-10-02

## Context

ZipZap handles COD: physical cash collected by riders and owed to merchants. Amounts in BDT reach
hundreds of thousands per shipment and millions per settlement. Errors are not cosmetic — they are
disputed payments.

Floating point cannot represent `1250.50` exactly, and the error compounds across a settlement of
10,000 shipments.

## Decision

**Every amount is an integer count of minor units, plus a currency code. Never a float,
anywhere, including tests and logs.**

```ts
interface Money {
  readonly amountMinor: number; // 125050
  readonly currency: 'BDT';
}
```

```sql
amount_minor bigint  NOT NULL,
currency     char(3) NOT NULL,
```

Rules:

- No `parseFloat`, no `toFixed`, no multiplication on money. Integer addition, subtraction,
  multiplication by an integer quantity, and division with an explicit remainder.
- **No `Math.round`.** If a calculation produces a fraction, the division is wrong or the rule
  must state where the remainder goes.
- **No bare numbers.** `Money` always carries its currency. Adding across currencies is a bug,
  not a conversion.
- **`bigint` columns**, with an explicit `pg` type parser so values arrive as numbers.
- Remainder allocation is explicit and tested. A settlement that loses 3 poisha per shipment
  across 10,000 shipments is a ৳30,000 discrepancy nobody finds for a month.

BDT amounts sit far inside `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991 poisha ≈ ৳90
trillion), so a JS `number` is exact for this domain. The parser must still be explicit.

## Consequences

### Positive

- Arithmetic is exact and associative — no rounding surprises, ever.
- Totals are verifiable by summing integers, which makes reconciliation mechanical.
- No rounding-policy ambiguity in the database.
- Testable exhaustively, because there are no float edge cases.

### Negative

- Every display and parsing path converts, and a conversion site is a bug site.
- `Money` is not assignable to `number`, so arithmetic needs intent at every call.
- Division needs an explicit remainder policy, which is more code.
- Legacy `numeric` columns from other systems need conversion on import.

## Alternatives considered

**Decimal.js / big.js.** A large precision library. Rejected: `bigint` arithmetic is native and
exact, and the domain needs addition, subtraction, and multiplication by integers — not the full
decimal-transcendental surface. Adding a library to solve a problem the language already solves is
the wrong trade. Revisit if percentage or compounding is ever needed.

**Postgres `numeric`.** Exact, and a reasonable storage type. Rejected as the primary type
because every read comes back as a string and integer arithmetic is faster and simpler in
application code. It is a reasonable choice for a column that is never computed on; money here is
constantly computed on.

**Minor units only, no currency.** Rejected: the code becomes implicitly BDT and converting to
another market later becomes a schema change in every table.

**Store major units as `numeric(12,2)`.** Rejected: ৳1,250.50 still cannot be represented exactly
as a float, and the illusion of safety is worse than an explicit integer.
