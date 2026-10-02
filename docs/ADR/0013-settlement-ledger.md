# ADR-0013: Append-only ledger with derived balances

**Status** accepted · 2026-10-02

## Context

COD means a rider hands a merchant ৳125,050 in cash. ZipZap owes that to the merchant. Some
rider will eventually hand in a different amount, and someone must explain the difference.

The system has to answer: who collected what, what is owed, and what was already settled — months
later, during a dispute. If the answer requires reading a mutable balance column, it is not
answerable.

## Decision

**There is no `merchant.balance` column. The ledger is append-only. Every balance is derived
from entries.**

```sql
direction     smallint NOT NULL,   -- +1 | -1
amount_minor  bigint   NOT NULL CHECK (amount_minor > 0)
```

Rules:

1. **Append-only.** `REVOKE UPDATE, DELETE ON finance.ledger_entries FROM zipzap_app;` — enforced
   by the database, not by review.
2. **Corrections are compensating entries.** The wrong row stays visible; a new row explains it.
3. **Balance is a `SUM`**, never a counter. `SUM(direction * amount_minor)`.
4. **`direction` is separate from the sign of the amount**, so the sign is never derived from a
   value that could be zero.
5. **Every entry references its source** — `reference_type` + `reference_id`. An entry nobody
   can trace to a shipment is unauditable money.
6. **`recorded_at` is distinct from `occurred_at`.** A COD collected yesterday is reconciled
   today; audit needs both.
7. **A settlement is a frozen view of entries**, not a recalculation. An approved settlement is a
   contract; late money goes to the next one.

## Consequences

### Positive

- **Any figure can be reconstructed** from rows, so disputes are settled with evidence.
- There is no counter to drift. A retry or a manual fix cannot corrupt a stored balance.
- If something is wrong, it is visible as a bad row, not as a wrong total nobody can trace.
- Auditability is a property of the design, not a feature added later.

### Negative

- **Sums get slow.** Mitigated by indexing and, where needed, a rebuildable projection.
- Storage grows forever. Non-negotiable — this is the financial record.
- Every entry needs a source reference, which is discipline rather than a mechanism.
- Writing off an error requires an explicit compensating entry, which is more deliberate than
  an `UPDATE` and exactly the point.

### Where this hurts most

An approved settlement cannot be corrected. It is a contract. Money that arrives late is carried
forward into the next settlement, which is operationally annoying and legally correct — a
settlement a merchant has already been paid against cannot be rewritten underneath them.

## Alternatives considered

**A mutable `balance` column on the merchant.** Rejected: it drifts, and once it drifts nobody can
tell how far or in which direction. It also makes `SELECT balance FROM merchant` the fast path
everyone uses, and the only path that loses information.

**Update the previous entry on correction.** Rejected outright. It destroys the audit trail, and
"what happened" is the only reason to keep a ledger.

**Event-sourced balances from the event log.** Rejected: correct, and a large amount of machinery
to answer questions Postgres answers with a `SUM`. Reserve for if the ledger itself must be
reconstructed — the outbox plus the entry rows already is the event log.

**Double-entry with full chart of accounts.** More rigorous, and mostly necessary for a general
ERP. Overkill here: this needs to be exactly auditable, not a general accounting system.
Revisit if multi-currency or inter-company settlement arrives.
