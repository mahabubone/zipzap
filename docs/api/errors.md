# Errors

One envelope. Mapped once. Never hand-built.

## Shape

```json
{
  "type": "https://api.zipzap.example/errors/shipment-not-found",
  "title": "Shipment not found",
  "status": 404,
  "code": "SHIPMENT_NOT_FOUND",
  "detail": "No shipment exists for the supplied identifier.",
  "request_id": "req_123"
}
```

RFC 9457 problem details, plus `code` and `request_id`.

**Errors are a stable API contract.** A merchant's integration branches on `code`. Rewording a
message is fine; changing a `code` is a breaking change.

## The rule

Domain errors are plain `Error` subclasses in `domain/`. They are mapped to this envelope in a
**single exception filter**. Controllers never construct an error response.

```
domain throws  →  filter maps  →  envelope  →  client
```

A domain error missing from the map is a bug: it surfaces as a 500 and hides a real condition
behind "internal server error". The map is exhaustive over the domain error types, and a test
asserts that.

## Codes

| Code                       | Status | Meaning                                         |
| -------------------------- | ------ | ----------------------------------------------- |
| `VALIDATION_FAILED`        | 400    | request body failed validation                  |
| `INVALID_IDEMPOTENCY_KEY`  | 400    | key reused with a different body                |
| `AUTHENTICATION_REQUIRED`  | 401    | no or invalid credential                        |
| `INVALID_CREDENTIALS`      | 401    | credential rejected                             |
| `PERMISSION_DENIED`        | 403    | authenticated but not permitted                 |
| `RESOURCE_NOT_FOUND`       | 404    | no such resource in this tenant                 |
| `SHIPMENT_NOT_FOUND`       | 404    | no such shipment                                |
| `INVALID_TRANSITION`       | 409    | state machine rejected the transition           |
| `DUPLICATE_REQUEST`        | 409    | idempotency key already used                    |
| `SERVICEABILITY_FAILED`    | 422    | destination not serviceable                     |
| `INSUFFICIENT_COD`         | 422    | collected below expected                        |
| `RECONCILIATION_EXCEPTION` | 422    | cash does not reconcile                         |
| `RATE_LIMITED`             | 429    | see [rate-limits.md](rate-limits.md)            |
| `DEPENDENCY_UNAVAILABLE`   | 503    | Postgres or another required dependency is down |
| `INTERNAL_ERROR`           | 500    | a bug — never branch on it                      |

## Three decisions worth stating

**404, not 403, for cross-tenant access.** Returning 403 confirms the resource exists, which is
an enumeration oracle.

**409 for state conflicts, 422 for business-rule failures.** `INVALID_TRANSITION` is 409 — the
resource exists and the request conflicts with its state. `SERVICEABILITY_FAILED` is 422 — the
request was well-formed and the business rules rejected it. Clients can act on the difference.

**503 with `Retry-After` when Postgres is down.** Not 500. The request did not fail, the system
could not be reached, and the client is right to retry. This is the difference between a
retryable outage and a support ticket.

## `request_id`

Every response carries `request_id`, matching the OpenTelemetry trace. A merchant reporting a
problem gives you that one string; it finds the exact request, its trace, and every log line and
span it produced.

The cheapest support tooling in the system, and it depends entirely on generating the id at the
edge and propagating it. Never derive it downstream.

## Details

`detail` is a sentence for the developer. It may name the rule that failed ("weight exceeds the
maximum for size S") but **never** contains secrets, stack traces, SQL, or internal identifiers.

Stack traces and SQL go to server logs, keyed by `request_id` — never into a response.

---

Related: [versioning.md](versioning.md) · [pagination.md](pagination.md) ·
[../architecture/module-boundaries.md](../architecture/module-boundaries.md)
