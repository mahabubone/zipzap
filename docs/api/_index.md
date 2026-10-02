# API

Public and internal HTTP contract. Versioned, generated, and tested as a contract.

## Documents

|                                  |                                      |
| -------------------------------- | ------------------------------------ |
| [auth.md](auth.md)               | API keys, sessions, scopes, rotation |
| [versioning.md](versioning.md)   | `/v1`, deprecation, compatibility    |
| [errors.md](errors.md)           | the §87 error envelope               |
| [pagination.md](pagination.md)   | cursor pagination                    |
| [idempotency.md](idempotency.md) | safe retries                         |
| [bulk.md](bulk.md)               | asynchronous bulk processing         |
| [webhooks.md](webhooks.md)       | outbound events, signing, retries    |
| [rate-limits.md](rate-limits.md) | per-tier limits and headers          |

## Contract principle

The API contract is a first-class artefact. Changes to request shape, response shape, status
codes, authentication, metadata, pagination, or errors **must** trigger an OpenAPI regeneration
and a contract test.

`packages/api-client` is generated from the backend's OpenAPI output. Hand-editing either is a
bug — they are both outputs of the controller decorators.

## Core endpoints

```
POST   /v1/shipments
POST   /v1/shipments/bulk
GET    /v1/shipments/:id
GET    /v1/shipments
POST   /v1/shipments/:id/cancel
POST   /v1/pickups
GET    /v1/pickups
GET    /v1/tracking/:trackingCode
GET    /v1/returns
POST   /v1/returns
GET    /v1/cod
GET    /v1/settlements
GET    /v1/webhooks
POST   /v1/webhooks
DELETE /v1/webhooks/:id
```

Public, unauthenticated:

```
GET    /track/:trackingCode
GET    /healthz
GET    /docs
```

## Validation

DTOs are validated with `class-validator` at the transport boundary, and only there. A domain
object does not re-validate transport concerns — it validates its own invariants, which is a
different and stricter thing.

Validation is a trust boundary. Never simplify it away.

## Rate limiting

Every tier has its own policy. See [rate-limits.md](rate-limits.md).
