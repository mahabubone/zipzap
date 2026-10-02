# customer

The recipient. Phase 1.

---

## Owns

`customer` schema: `customers`, `phones`, `addresses`, `contact_history`, `delivery_history`.

## Why a separate module

Shipment records are a **point-in-time snapshot**. A customer is a **living record**. The moment
they diverge, keeping both is unavoidable and storing snapshots is mandatory.

If a recipient moves, their _customer_ address changes. Every shipment already sent must still
show where it was actually delivered. That is the whole reason these are separate entities — and
the reason [shipment](shipment.md) copies recipient data rather than joining to it.

## Rules

1. **Phone numbers are normalised and unique.** Bangladesh format, E.164 storage: `+8801XXXXXXXXX`.
   `017XXXXXXXX`, `880171XXXXXXX`, and `+880 17 1XXX XXXX` are the same number.
2. **A customer may have many addresses and many phones.** Neither is a column.
3. **Contact history is append-only.** Who contacted whom, when, through which channel.
4. **Customer records are separate from shipment records**, and the two are linked by an
   identifier — never by a cross-schema join.
5. **Contact data is the most sensitive thing in the database.** Minimise, restrict, audit reads,
   never log. See [../architecture/database.md](../architecture/database.md#privacy).

## Phone normalisation

```
01[3-9]\d{8}      → +8801XXXXXXXXX
8801[3-9]\d{8}    → +8801XXXXXXXXX
\+8801[3-9]\d{8}  → +8801XXXXXXXXX
```

Normalise on write, store E.164, and key risk scoring on the normalised form — otherwise the
same recipient defeats duplicate-detection by typing their number two ways.

## Delivery history

A denormalised projection of shipment outcomes per customer: counts of delivered, returned,
refused, and attempted. This is what makes a 35% return rate on a phone number visible to risk
scoring.

It is a **projection**, not a query across `shipment`. It is fed by events and is rebuildable.
It may be stale by seconds; that is fine, because it informs a decision rather than recording a
fact.

## Delivery history and privacy

This projection is a behavioural profile of a named person. It is access-controlled with
`customer:read`, audited on read, and included in privacy deletion — subject to the conflict
noted in [database.md](../architecture/database.md#privacy-and-correctness-together): a
financial record is pseudonymised, never erased.

## Must not touch

`shipment` tables. It knows how many shipments a customer has; it does not read them.

---

Related: [shipment](shipment.md) · [identity](identity.md) · [analytics](analytics.md)
