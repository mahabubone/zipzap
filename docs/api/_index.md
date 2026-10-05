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

Status as of 2026-10-05 — ✅ live, 🔲 named but not built:

```
POST   /v1/shipments                        ✅ create (Idempotency-Key required)
GET    /v1/shipments                        ✅ cursor-paginated list
GET    /v1/shipments/:id                    ✅ detail, own merchant only
POST   /v1/shipments/:id/cancel             ✅ validated cancel (CANCELLED is terminal)
POST   /v1/shipments/bulk/upload            ✅ async upload → preview checkpoint
POST   /v1/shipments/bulk/accept            ✅ accept → 100-row chunks
GET    /v1/shipments/bulk/:jobId            ✅ progress
GET    /v1/shipments/bulk/:jobId/result     ✅ row-level result CSV
POST   /v1/pickups                          ✅ request
POST   /v1/pickups/:id/assign               ✅ assign
GET    /v1/pickups                          ✅ cursor-paginated list
POST   /v1/returns                          ✅ request
POST   /v1/returns/:id/approve              ✅ approve
POST   /v1/returns/:id/reject               ✅ reject
POST   /v1/returns/:id/advance              ✅ custody-leg advance
GET    /v1/returns                          ✅ cursor-paginated list (`returns:read`)
POST   /v1/cod/collect                      ✅ collect (idempotency-keyed)
POST   /v1/cod/reconcile                    ✅ reconcile with reviewer note
GET    /v1/cod                              ✅ cursor-paginated list (`cod:read`)
GET    /v1/settlements                      ✅ cursor-paginated list
GET    /v1/webhooks                         ✅ list own endpoints (bounded, unpaginated)
POST   /v1/webhooks                         ✅ register (secret returned once)
```

Deliberate non-endpoints (not gaps — decisions):

- `POST /v1/shipments/bulk` (single-shot): superseded by upload → preview → accept.
  The preview checkpoint exists because the first upload always has a
  column-mapping mistake, and 10,000 mis-mapped shipments is a support incident.
- `DELETE /v1/webhooks/:id`: pause, don't delete. A deleted endpoint silently drops
  events the merchant still expects; `PAUSED` keeps the config visible.
- `GET /v1/tracking/:trackingCode`: the public `/track/:trackingCode` projection
  serves this; a second authenticated read would be a second shape for the same fact.

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
