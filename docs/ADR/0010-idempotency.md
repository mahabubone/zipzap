# ADR-0010: Mandatory `Idempotency-Key` on money and physical actions

**Status** accepted · 2026-10-02

## Context

Every client retries. Merchants retry on timeout. Riders rescan on a flaky connection. Proxies
retry. Webhooks deliver more than once. This is not exceptional — it is the normal behaviour of
HTTP over unreliable networks.

On a timeout the client does not know whether the operation committed. Retrying is the only
correct response. So the server must make a retry safe.

## Decision

**`Idempotency-Key` is mandatory on operations that move money or physical custody:**

| Operation              | Consequence of a duplicate               |
| ---------------------- | ---------------------------------------- |
| Shipment create        | double-charged, double parcel            |
| Bulk import            | 10,000 duplicate shipments               |
| **COD collect**        | **money created from nothing**           |
| Delivery confirm       | two proofs, two deliveries               |
| **Settlement approve** | **two payments**                         |
| Rider offline sync     | duplicate scans, corrupt custody history |

Mechanism:

```
INSERT INTO system.idempotency_keys (scope, key, request_hash, response_code, response_body, …)
VALUES (…)
ON CONFLICT (scope, key) DO NOTHING
```

- **Insert wins** → run the operation, store the response, in the same transaction
- **Conflict + same request hash** → replay the stored response
- **Conflict + different request hash** → `400 INVALID_IDEMPOTENCY_KEY`

Supporting decisions:

- **Store the response, not a flag.** A replay must return the original result, not a 409 — the
  client cannot proceed with a 409 and does not know whether it now has two parcels.
- **Hash the request body**, so a client reusing a key for a different payload gets an error
  rather than a misleading success.
- **Scope the key** per operation class and per merchant. Two merchants using `order-1` are two
  different requests.
- **The unique constraint is the concurrency control**, not a check-then-insert. Two simultaneous
  requests, exactly one wins.
- **The row is inside the transaction**, so it cannot outlive a rollback and permanently block a
  request that never happened.

## Consequences

### Positive

- Retries are safe, so clients and infrastructure can retry freely.
- The stored response means a timed-out request is still answerable.
- The unique constraint removes a whole class of race conditions.
- Retention becomes a correctness question with a stated answer.

### Negative

- Every mutating endpoint stores a row — write amplification on the hot path.
- Financial operations must retain keys far longer than operational ones, indefinitely enough for
  a merchant to dispute a collection months later.
- Clients must be taught to send the header, and a client that omits it gets a 400.
- The mechanism must be applied consistently; a forgotten endpoint silently loses the property.

## Alternatives considered

**Detect duplicates after the fact** (unique business constraints, reconciliation). Rejected for
financial operations: by the time you detect a duplicate COD collection, the money exists. Two
collections is a fact; the second is a compensating entry that has to be found, explained, and
reversed. Prevention is cheaper than detection.

**Only the client deduplicates.** Rejected: the client cannot know whether its first attempt
committed. That is exactly the uncertainty the key resolves.

**Request hashes instead of client keys.** Rejected: two genuinely distinct shipments with
identical bodies are legitimate, and would collide.

**Let duplicates through and make consumers idempotent downstream.** Rejected: sufficient for
event consumers ([ADR-0005](0005-transactional-outbox.md)), insufficient for a synchronous
financial API where the caller needs an answer.
