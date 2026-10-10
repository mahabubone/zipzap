/**
 * `@ApiErrors` — every failure a route can produce, declared once.
 *
 * Controllers never build error responses; `DomainExceptionFilter` maps a domain error to the §87
 * envelope in one place. The spec should say the same thing, or a client has to discover the four
 * shapes by trial and error. This applies the full set so no endpoint documents only its happy
 * path, and so adding a shape later is a one-line change rather than a sweep of 83 controllers.
 *
 * Bound to `ErrorEnvelopeDto`, the type mirror of `toEnvelope`.
 */

import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiServiceUnavailableResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorEnvelopeDto } from './dto/errors.ts';

export function ApiErrors(): MethodDecorator {
  return applyDecorators(
    ApiBadRequestResponse({
      description: 'Validation failed. Nothing was written.',
      type: ErrorEnvelopeDto,
    }),
    ApiUnauthorizedResponse({
      description: 'No valid credential was presented.',
      type: ErrorEnvelopeDto,
    }),
    ApiForbiddenResponse({
      description: 'Authenticated, but missing the required scope.',
      type: ErrorEnvelopeDto,
    }),
    ApiNotFoundResponse({
      description: 'The record does not exist, or belongs to another tenant.',
      type: ErrorEnvelopeDto,
    }),
    ApiTooManyRequestsResponse({
      description: 'Rate limited. Honour `Retry-After`.',
      type: ErrorEnvelopeDto,
    }),
    ApiServiceUnavailableResponse({
      description: 'A required dependency is unreachable. Nothing was written.',
      type: ErrorEnvelopeDto,
    }),
    ApiInternalServerErrorResponse({
      description: 'Unexpected failure. The `request_id` identifies it in our logs.',
      type: ErrorEnvelopeDto,
    }),
  );
}
