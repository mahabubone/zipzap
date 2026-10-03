/**
 * Domain errors. Plain Error subclasses, framework-free, living in `domain/` layers.
 *
 * A single exception filter maps every one of these to the §87 envelope. Controllers
 * never construct an error response.
 */

export interface DomainErrorSpec {
  readonly code: string;
  readonly status: number;
  readonly title: string;
}

export abstract class DomainError extends Error {
  abstract readonly spec: DomainErrorSpec;

  constructor(message?: string) {
    super(message ?? new.target.prototype.constructor.name);
    this.name = new.target.name;
  }

  /** The stable machine-readable code. Branches on this, never on the message. */
  get code(): string {
    return this.spec.code;
  }
}

// --- validation and authentication -------------------------------------------

export class ValidationFailedError extends DomainError {
  readonly spec = {
    code: 'VALIDATION_FAILED',
    status: 400,
    title: 'Validation failed',
  } satisfies DomainErrorSpec;

  constructor(readonly issues: readonly { path: string; message: string }[]) {
    super('The request failed validation.');
  }
}

export class AuthenticationRequiredError extends DomainError {
  readonly spec = {
    code: 'AUTHENTICATION_REQUIRED',
    status: 401,
    title: 'Authentication required',
  } satisfies DomainErrorSpec;
}

export class PermissionDeniedError extends DomainError {
  readonly spec = {
    code: 'PERMISSION_DENIED',
    status: 403,
    title: 'Permission denied',
  } satisfies DomainErrorSpec;
}

export class ResourceNotFoundError extends DomainError {
  readonly spec = {
    code: 'RESOURCE_NOT_FOUND',
    status: 404,
    title: 'Not found',
  } satisfies DomainErrorSpec;
}

export class ShipmentNotFoundError extends DomainError {
  readonly spec = {
    code: 'SHIPMENT_NOT_FOUND',
    status: 404,
    title: 'Shipment not found',
  } satisfies DomainErrorSpec;
}

export class PickupNotFoundError extends DomainError {
  readonly spec = {
    code: 'PICKUP_NOT_FOUND',
    status: 404,
    title: 'Pickup not found',
  } satisfies DomainErrorSpec;
}

export class PricingVersionNotFoundError extends DomainError {
  readonly spec = {
    code: 'PRICING_VERSION_NOT_FOUND',
    status: 409,
    title: 'Pricing version not found',
  } satisfies DomainErrorSpec;

  constructor(readonly version: number | null) {
    super(
      version === null
        ? 'No active pricing version exists.'
        : `No pricing version ${version} exists.`,
    );
  }
}

export class InvalidBatchError extends DomainError {
  readonly spec = {
    code: 'INVALID_BATCH',
    status: 422,
    title: 'Invalid pickup batch',
  } satisfies DomainErrorSpec;

  constructor(readonly reason: string) {
    super(reason);
  }
}

// --- conflicts and business rules ---------------------------------------------

export class DuplicateRequestError extends DomainError {
  readonly spec = {
    code: 'DUPLICATE_REQUEST',
    status: 409,
    title: 'Duplicate request',
  } satisfies DomainErrorSpec;
}

export class InvalidIdempotencyKeyError extends DomainError {
  readonly spec = {
    code: 'INVALID_IDEMPOTENCY_KEY',
    status: 400,
    title: 'Invalid idempotency key',
  } satisfies DomainErrorSpec;
}

export class InvalidTransitionError extends DomainError {
  readonly spec = {
    code: 'INVALID_TRANSITION',
    status: 409,
    title: 'Invalid state transition',
  } satisfies DomainErrorSpec;

  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Cannot move from ${from} to ${to}.`);
  }
}

export class ServiceabilityFailedError extends DomainError {
  readonly spec = {
    code: 'SERVICEABILITY_FAILED',
    status: 422,
    title: 'Destination not serviceable',
  } satisfies DomainErrorSpec;

  constructor(readonly reason: string) {
    super(reason);
  }
}

export class ReconciliationExceptionError extends DomainError {
  readonly spec = {
    code: 'RECONCILIATION_EXCEPTION',
    status: 422,
    title: 'Reconciliation exception',
  } satisfies DomainErrorSpec;
}

// --- infrastructure -----------------------------------------------------------

export class DependencyUnavailableError extends DomainError {
  readonly spec = {
    code: 'DEPENDENCY_UNAVAILABLE',
    status: 503,
    title: 'Dependency unavailable',
  } satisfies DomainErrorSpec;
}

/**
 * The exhaustive registry. A DomainError subclass missing from this map is a bug: it
 * surfaces as a 500 and hides a real condition behind "internal server error".
 * `test/domain-error.test.ts` asserts the map covers every subclass.
 *
 * `any[]` in the constructor type is deliberate: these subclasses have different
 * constructor signatures, and a stricter type makes the heterogeneous Map unbuildable.
 * The map is still checked against the exhaustive list in the test.
 */
export type DomainErrorClass = new (...args: any[]) => DomainError;

export const DOMAIN_ERROR_SPECS: ReadonlyMap<DomainErrorClass, DomainErrorSpec> = new Map<
  DomainErrorClass,
  DomainErrorSpec
>([
  [ValidationFailedError, new ValidationFailedError([]).spec],
  [AuthenticationRequiredError, new AuthenticationRequiredError().spec],
  [PermissionDeniedError, new PermissionDeniedError().spec],
  [ResourceNotFoundError, new ResourceNotFoundError().spec],
  [ShipmentNotFoundError, new ShipmentNotFoundError().spec],
  [PickupNotFoundError, new PickupNotFoundError().spec],
  [PricingVersionNotFoundError, new PricingVersionNotFoundError(null).spec],
  [InvalidBatchError, new InvalidBatchError('reason').spec],
  [DuplicateRequestError, new DuplicateRequestError().spec],
  [InvalidIdempotencyKeyError, new InvalidIdempotencyKeyError().spec],
  [InvalidTransitionError, new InvalidTransitionError('A', 'B').spec],
  [ServiceabilityFailedError, new ServiceabilityFailedError('reason').spec],
  [ReconciliationExceptionError, new ReconciliationExceptionError().spec],
  [DependencyUnavailableError, new DependencyUnavailableError().spec],
]);

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
