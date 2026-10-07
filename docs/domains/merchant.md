# merchant

The paying customer. Phase 1.

---

## Owns

`merchant` schema: `merchants`, `users`, `branches`, `addresses`, `contracts`,
`pricing_profiles`, `settlement_accounts`, `api_credentials`, `webhooks`, `sessions`.

`sessions` (bearer tokens for human login) and `merchants.password_hash` shipped 2026-10-07
(migration 0031). A merchant with a NULL password hash cannot log in.

## Lifecycle

```
APPLIED → UNDER_REVIEW → VERIFIED → ACTIVE ⇄ SUSPENDED
```

Suspending is reversible and audited. It blocks new shipments but preserves in-flight ones —
suspending a merchant must not orphan parcels that are already on a truck.

## Rules

1. **API secrets are never stored raw.** Store a hash for verification, and encrypt a copy for
   display-once. Support rotation, revocation, `last_used_at`, and scopes.
2. **Credentials are revocable and every revocation is audited.** "Shipment reassigned" and
   "API credential revoked" are both [audit events](../architecture/module-boundaries.md).
3. **Every mutation is scoped to one merchant.** Derived from the credential, never from the
   request body. A client-supplied `merchantId` is ignored, not trusted.
4. **Contracts and pricing profiles are versioned.** Changing a price must not rewrite what was
   already quoted.
5. **Bulk import is idempotent on merchant invoice reference.** Re-uploading the same file must
   not duplicate 10,000 shipments.

## API credentials

Scopes: `shipments:read`, `shipments:write`, `tracking:read`, `returns:write`,
`settlements:read`, `webhooks:manage`.

Authentication is `key_id.secret`. The `key_id` selects the row; the secret is compared against
a hash. Rate limits are per merchant, configured per contract. See
[../api/auth.md](../api/auth.md).

## Webhooks

Endpoints, subscribed events, signing secrets, retry policy, and delivery logs. Delivery is
retried 1m → 5m → 15m → 1h → 6h → 24h, and every attempt is an immutable log row whether it
succeeded or not. See [../api/webhooks.md](../api/webhooks.md).

## Branches and addresses

A merchant has branches. Shipments originate from a branch address, which is why the address is
a merchant entity rather than a string on the shipment.

## Emits

`MerchantCreated`, `MerchantVerified`, `MerchantSuspended`, `MerchantResumed`,
`MerchantPricingChanged`.

## Consumes

`SettlementCompleted` — to notify the merchant and refresh dashboard projections.

## Must not touch

`shipment`, `finance`, `pricing` tables. It holds `merchantId` on those. Merchant balance is
**not** stored here — it is derived from the ledger in
[finance](finance.md), and duplicating it here is how two sources of truth get created.

## Dashboard

Total shipments, today's orders, delivered, in transit, failed, returned, COD outstanding,
available and pending settlement, average delivery time, return rate. Charts: shipments per day,
delivery success rate, return rate, COD collected, settlement history.

These are projections fed by events, not queries against five schemas at page load.

---

Related: [identity](identity.md) · [pricing](pricing.md) · [finance](finance.md) ·
[../api/webhooks.md](../api/webhooks.md)
