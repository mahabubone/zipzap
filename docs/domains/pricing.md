# pricing

Configurable pricing rules and versioned quotes. Phase 1.

---

## Owns

`pricing` schema: `rules`, `zones`, `weight_slabs`, `plans`, `merchant_profiles`, `contracts`,
`quotes`, `versions`.

## Rules

1. **No price is ever hardcoded in a handler.** No `if (weight > 5) fee = 80`. A rate change is
   a data change, deployed as configuration.
2. **A quote is versioned**, and a shipment stores the `pricingVersion` it used. Without that, a
   price dispute months later cannot be answered.
3. **The composition is explicit and itemised.** The quote shows every line, so a merchant can
   see what they are paying for.
4. **Pricing is deterministic.** Same inputs, same version, same quote — always. No clock, no
   randomness, no network calls.

## Composition

```
base delivery fee
  + weight surcharge
  + COD fee
  + remote area fee
  + special handling
  + packaging
  + VAT / tax
  − merchant discount
= total
```

A quote returns every component separately, never just a total. A merchant disputing ৳120 needs
to know which of six charges it was.

## Resolution order

```
default pricing
  → merchant pricing profile
  → volume discount
  → custom contract
```

Most specific wins, at each component. Not "the whole price comes from the contract" — that
makes partial overrides impossible and every negotiation a special case.

## Contract pricing

A large merchant may have custom `base_delivery_fee`, `cod_fee`, `return_fee`, and `weight_rules`.
Stored as configuration against a versioned contract, effective from a date.

## Interface

```ts
interface PricingService {
  quote(request: QuoteRequest): Promise<Quote>;
}
```

```ts
interface Quote {
  readonly version: number;
  readonly subtotalMinor: number;
  readonly deliveryFeeMinor: number;
  readonly codFeeMinor: number;
  readonly handlingFeeMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly currency: 'BDT';
  readonly lines: readonly QuoteLine[]; // itemised, always
}
```

Money is integer minor units throughout. See
[../architecture/money-and-ledger.md](../architecture/money-and-ledger.md).

## Determinism, stated as a test

Quoting must be a pure function of `(inputs, pricingVersion)`. That means no reading the current
time inside the engine, no random discounts, no calling an external service.

This is not theoretical fastidiousness. It is what lets a shipment be re-priced months later and
produce the identical number — which is the only reason a price dispute can be settled with
evidence instead of opinion.

## Must not touch

`shipment`, `merchant`, `finance` tables. A shipment requests a quote and stores the result; the
rules live here and nowhere else.

---

Related: [../architecture/money-and-ledger.md](../architecture/money-and-ledger.md) ·
[merchant](merchant.md) · [network](network.md)
