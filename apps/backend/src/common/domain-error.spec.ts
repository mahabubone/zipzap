import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  AuthenticationRequiredError,
  DependencyUnavailableError,
  DOMAIN_ERROR_SPECS,
  DomainError,
  DuplicateRequestError,
  InvalidIdempotencyKeyError,
  InvalidTransitionError,
  PermissionDeniedError,
  ReconciliationExceptionError,
  ResourceNotFoundError,
  ServiceabilityFailedError,
  ShipmentNotFoundError,
  ValidationFailedError,
  type DomainErrorSpec,
} from './domain-error.ts';
import { toEnvelope } from './error-envelope.ts';

/**
 * Every DomainError subclass. A subclass missing from DOMAIN_ERROR_SPECS surfaces as a 500
 * and hides a real condition behind "internal server error", so exhaustiveness is asserted
 * rather than assumed.
 *
 * Adding a class to domain-error.ts without adding it here fails `every subclass is mapped`.
 * Adding one here without registering it in the map fails the same test.
 */
const ALL_ERROR_CLASSES = [
  ValidationFailedError,
  AuthenticationRequiredError,
  PermissionDeniedError,
  ResourceNotFoundError,
  ShipmentNotFoundError,
  DuplicateRequestError,
  InvalidIdempotencyKeyError,
  InvalidTransitionError,
  ServiceabilityFailedError,
  ReconciliationExceptionError,
  DependencyUnavailableError,
] as const;

describe('domain errors', () => {
  test('every subclass is mapped, and the map has no orphans', () => {
    assert.equal(
      DOMAIN_ERROR_SPECS.size,
      ALL_ERROR_CLASSES.length,
      'DOMAIN_ERROR_SPECS and the test list have drifted apart — a new DomainError needs registering in both.',
    );
    for (const ctor of ALL_ERROR_CLASSES) {
      assert.ok(
        DOMAIN_ERROR_SPECS.has(ctor as never),
        `${ctor.name} is missing from DOMAIN_ERROR_SPECS`,
      );
    }
  });

  test('every spec is well-formed', () => {
    for (const [ctor, spec] of DOMAIN_ERROR_SPECS) {
      assert.equal(
        new (ctor as unknown as new () => DomainError)().constructor,
        ctor,
        `${ctor.name} does not construct what it claims`,
      );
      assert.match(spec.code, /^[A-Z][A-Z0-9_]*$/);
      assert.ok(spec.status >= 400 && spec.status < 600, `${spec.code} has status ${spec.status}`);
      assert.ok(spec.title.length > 0);
    }
  });

  test('no duplicate codes — a client branches on these', () => {
    const codes = [...DOMAIN_ERROR_SPECS.values()].map((spec) => spec.code);
    assert.equal(new Set(codes).size, codes.length);
  });

  test('carries a stable machine-readable code', () => {
    assert.equal(new ShipmentNotFoundError().code, 'SHIPMENT_NOT_FOUND');
    assert.equal(
      new InvalidTransitionError('OUT_FOR_DELIVERY', 'DELIVERED').code,
      'INVALID_TRANSITION',
    );
  });

  test('preserves the offending state pair for the audit trail', () => {
    const error = new InvalidTransitionError('SORTING', 'DELIVERED');
    assert.equal(error.from, 'SORTING');
    assert.equal(error.to, 'DELIVERED');
    assert.match(error.message, /SORTING/);
    assert.match(error.message, /DELIVERED/);
  });
});

describe('error envelope', () => {
  const spec: DomainErrorSpec = {
    code: 'SHIPMENT_NOT_FOUND',
    status: 404,
    title: 'Shipment not found',
  };

  test('derives a stable problem type from the code', () => {
    assert.equal(
      toEnvelope(spec, 'nope', 'req_1').type,
      'https://api.zipzap.example/errors/shipment-not-found',
    );
  });

  test('carries request_id so a merchant reporting a problem gives us one string', () => {
    assert.equal(toEnvelope(spec, 'nope', 'req_123').request_id, 'req_123');
  });

  test('matches the §87 shape exactly', () => {
    assert.deepEqual(toEnvelope(spec, 'No shipment exists.', 'req_123'), {
      type: 'https://api.zipzap.example/errors/shipment-not-found',
      title: 'Shipment not found',
      status: 404,
      code: 'SHIPMENT_NOT_FOUND',
      detail: 'No shipment exists.',
      request_id: 'req_123',
    });
  });
});
