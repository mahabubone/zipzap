/**
 * The single place a domain error becomes an HTTP response.
 *
 * Registered globally in main.ts. Controllers never build an error body.
 * The envelope itself lives in error-envelope.ts so it can be tested without NestJS.
 */

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DOMAIN_ERROR_SPECS, isDomainError, type DomainErrorClass } from './domain-error';
import { INTERNAL_ERROR_SPEC, toEnvelope } from './error-envelope';

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const requestId = String(request.headers['x-request-id'] ?? 'unknown');

    if (isDomainError(exception)) {
      const spec =
        DOMAIN_ERROR_SPECS.get(exception.constructor as DomainErrorClass) ?? INTERNAL_ERROR_SPEC;
      response.status(spec.status).json(toEnvelope(spec, exception.message, requestId));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response
        .status(status)
        .json(
          toEnvelope(
            { code: 'HTTP_ERROR', status, title: exception.name },
            'The request could not be processed.',
            requestId,
          ),
        );
      return;
    }

    // Stack traces and SQL go to the log, keyed by request_id — never into a response.
    this.logger.error({ requestId, path: request.url, err: exception }, 'unhandled exception');
    response
      .status(INTERNAL_ERROR_SPEC.status)
      .json(toEnvelope(INTERNAL_ERROR_SPEC, 'An unexpected error occurred.', requestId));
  }
}
