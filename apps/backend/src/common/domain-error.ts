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

export class CommandQueueFullError extends DomainError {
  readonly spec = {
    code: 'COMMAND_QUEUE_FULL',
    status: 409,
    title: 'Command queue full',
  } satisfies DomainErrorSpec;

  constructor(
    readonly queueSize: number,
    readonly cap: number,
  ) {
    super(`Command queue full: ${queueSize} pending, cap ${cap}.`);
  }
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

export class CodRecordNotFoundError extends DomainError {
  readonly spec = {
    code: 'COD_RECORD_NOT_FOUND',
    status: 404,
    title: 'COD record not found',
  } satisfies DomainErrorSpec;
}

/**
 * A settlement that does not exist, or belongs to another merchant.
 *
 * One error for both, on purpose: `assertTenant` runs after the lookup and throws this rather than
 * `PermissionDeniedError`, because a 403 confirms the row exists and a settlement id is sequential
 * enough to be enumerated. Same reasoning as `assertTenant` itself.
 */
export class SettlementNotFoundError extends DomainError {
  readonly spec = {
    code: 'SETTLEMENT_NOT_FOUND',
    status: 404,
    title: 'Settlement not found',
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

/**
 * A manifest whose cargo has not all arrived. 422, not 409: the manifest is
 * fine, the world has not caught up yet — a business-rule rejection that a
 * later retry can pass, never a state conflict the client caused.
 */
export class ManifestIncompleteError extends DomainError {
  readonly spec = {
    code: 'MANIFEST_INCOMPLETE',
    status: 422,
    title: 'Manifest incomplete',
  } satisfies DomainErrorSpec;

  constructor(readonly shipmentIds: readonly string[] = []) {
    super(
      `Manifest is missing ${shipmentIds.length} shipment(s) at reconciliation: ` +
        `${shipmentIds.slice(0, 5).join(', ')}${shipmentIds.length > 5 ? ', …' : ''}`,
    );
  }
}

export class RateLimitedError extends DomainError {
  readonly spec = {
    code: 'RATE_LIMITED',
    status: 429,
    title: 'Too many requests',
  } satisfies DomainErrorSpec;

  constructor(readonly retryAfterSeconds: number) {
    super(`Limit exceeded. Retry after ${retryAfterSeconds}s.`);
  }
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

/**
 * Proof of delivery. Five failure modes because the rider needs five different instructions —
 * "wait for a new code" and "stop guessing" are not the same message, and a single boolean would
 * collapse them into a shrug.
 *
 * These live here rather than in `delivery/rules/proof.ts` because `DOMAIN_ERROR_SPECS` is what turns
 * a domain error into a §87 envelope, and a class missing from that map answers 500 — an
 * infrastructure fault for what is a rider being told the truth about a doorstep.
 */
export class ProofCodeExpiredError extends DomainError {
  readonly spec = {
    code: 'PROOF_CODE_EXPIRED',
    status: 410,
    title: 'Delivery code expired',
  } satisfies DomainErrorSpec;
}

export class ProofCodeAttemptsExhaustedError extends DomainError {
  readonly spec = {
    code: 'PROOF_CODE_ATTEMPTS_EXHAUSTED',
    status: 429,
    title: 'Too many wrong codes',
  } satisfies DomainErrorSpec;
}

export class ProofCodeInvalidError extends DomainError {
  readonly spec = {
    code: 'PROOF_CODE_INVALID',
    status: 422,
    title: 'Wrong delivery code',
  } satisfies DomainErrorSpec;
}

export class ProofPhotoMissingError extends DomainError {
  readonly spec = {
    code: 'PROOF_PHOTO_REQUIRED',
    status: 422,
    title: 'Photo required',
  } satisfies DomainErrorSpec;
}

export class ProofPhotoTooLargeError extends DomainError {
  readonly spec = {
    code: 'PROOF_PHOTO_TOO_LARGE',
    status: 413,
    title: 'Photo too large',
  } satisfies DomainErrorSpec;
  constructor(
    readonly bytes: number,
    readonly max: number,
  ) {
    super(`Delivery photo is ${bytes} bytes; the limit is ${max}.`);
  }
}

export class ProofLocationImplausibleError extends DomainError {
  readonly spec = {
    code: 'PROOF_LOCATION_IMPLAUSIBLE',
    status: 422,
    title: 'Implausible location',
  } satisfies DomainErrorSpec;
}

/** Raised by `complete` when a rider tries to mark a parcel delivered with no evidence behind it. */
export class ProofRequiredError extends DomainError {
  readonly spec = {
    code: 'PROOF_REQUIRED',
    status: 409,
    title: 'Proof of delivery required',
  } satisfies DomainErrorSpec;
}

/**
 * A redemption arrived for a job that was never sent a code.
 *
 * Distinct from `ProofCodeExpiredError` on purpose: "expired" tells the rider to ask for a new code,
 * this tells them to ask for one *at all* — and it is the answer to a bug in the caller, not a
 * customer-facing dead end.
 */
export class ProofCodeNotIssuedError extends DomainError {
  readonly spec = {
    code: 'PROOF_CODE_NOT_ISSUED',
    status: 409,
    title: 'No delivery code issued',
  } satisfies DomainErrorSpec;
}

/**
 * There is no proof to capture here: the job is not at a door, or it was already proved.
 *
 * One error for both because the rider's next move is the same in each case — nothing. Splitting
 * them would only tell a caller which of two non-actions it was about to take.
 */
export class ProofNotAvailableError extends DomainError {
  readonly spec = {
    code: 'PROOF_NOT_AVAILABLE',
    status: 409,
    title: 'Proof not available',
  } satisfies DomainErrorSpec;
  constructor(message: string) {
    super(message);
  }
}

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
  [CodRecordNotFoundError, new CodRecordNotFoundError().spec],
  [PricingVersionNotFoundError, new PricingVersionNotFoundError(null).spec],
  [InvalidBatchError, new InvalidBatchError('reason').spec],
  [DuplicateRequestError, new DuplicateRequestError().spec],
  [InvalidIdempotencyKeyError, new InvalidIdempotencyKeyError().spec],
  [InvalidTransitionError, new InvalidTransitionError('A', 'B').spec],
  [ServiceabilityFailedError, new ServiceabilityFailedError('reason').spec],
  [ReconciliationExceptionError, new ReconciliationExceptionError().spec],
  [ManifestIncompleteError, new ManifestIncompleteError([]).spec],
  // Was missing, so a full offline queue surfaced as a 500 — an infrastructure fault for what is
  // ordinary backpressure. Unreachable only because no HTTP route could fill the queue; the moment
  // the device replay route landed it would have shipped. Caught by reading the spec against the
  // classes, which is what this map exists for.
  [CommandQueueFullError, new CommandQueueFullError(0, 0).spec],
  [RateLimitedError, new RateLimitedError(60).spec],
  [DependencyUnavailableError, new DependencyUnavailableError().spec],
  [ProofCodeExpiredError, new ProofCodeExpiredError().spec],
  [ProofCodeAttemptsExhaustedError, new ProofCodeAttemptsExhaustedError().spec],
  [ProofCodeInvalidError, new ProofCodeInvalidError().spec],
  [ProofPhotoMissingError, new ProofPhotoMissingError().spec],
  [ProofPhotoTooLargeError, new ProofPhotoTooLargeError(1, 2).spec],
  [ProofLocationImplausibleError, new ProofLocationImplausibleError().spec],
  [ProofRequiredError, new ProofRequiredError().spec],
  [ProofCodeNotIssuedError, new ProofCodeNotIssuedError().spec],
  [ProofNotAvailableError, new ProofNotAvailableError('x').spec],
]);

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
