# ADR-0004: OpenAPI generated from decorators

**Status** accepted · 2026-10-02

## Context

Nine surfaces plus a public API, all consuming one backend. The API contract must be a
first-class artefact, or every surface becomes a place where the contract is guessed.

## Decision

**`@nestjs/swagger` decorators on controllers generate the OpenAPI spec. The spec generates
`packages/api-client`.**

```
controller decorators  →  OpenAPI spec  →  api-client  →  every frontend
```

Both the spec and the client are **outputs**. Hand-editing either is a bug, for a specific
reason: the next regeneration silently discards the edit, so the change exists in the client but
not the server. That surfaces as a 404 in production and a confusing diff in review.

Regenerate and commit both, in the same commit as the controller change.

Supporting decisions:

- DTO classes with `@ApiProperty` are the request and response shapes. There is no second
  definition.
- Validation uses `class-validator` at the transport boundary, and only there.
- Swagger UI at `/docs`, gated in production.
- Contract tests assert the generated spec matches observed behaviour.

## Consequences

### Positive

- The spec cannot drift from the implementation, because it is derived from it.
- Frontend types are exact and generated, never hand-maintained in nine places.
- A contract change is visible in the diff of the spec.
- Validation and documentation come from the same DTO.

### Negative

- Decorators are noisy and the controller files are longer than their logic.
- `@ApiProperty` must be maintained alongside the type; forgetting it yields a wrong spec.
- Federation across services is not solved here — acceptable while we are one deployable.
- Generating a client needs a codegen step in CI.

## Alternatives considered

**Hand-written OpenAPI YAML.** Rejected: it is a second, manually-maintained description of the
API, guaranteed to drift. It is the single most common source of wrong integration docs.

**tRPC / GraphQL.** Rejected: a strong contract model, but it excludes the merchant API. The
public API must be plain HTTP with a public spec — third-party developers will not adopt a
framework-specific client.

**Write the spec first, generate stubs.** Rejected for the same reason as hand-written YAML, in
the opposite direction: the code then conforms to a stale document instead of the document
conforming to the code.

**NestJS without Swagger decorators.** Rejected: without them the spec is not derivable, and we
are back to hand-maintaining it.
