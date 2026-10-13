/**
 * The single place a domain error becomes an HTTP response.
 *
 * Registered globally in main.ts. Controllers never build an error body.
 * The envelope itself lives in error-envelope.ts so it can be tested without NestJS.
 */

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  DOMAIN_ERROR_SPECS,
  DependencyUnavailableError,
  isDomainError,
  type DomainErrorClass,
} from './domain-error';
import { INTERNAL_ERROR_SPEC, toEnvelope } from './error-envelope';
import { resolveRequestId } from './request-id.ts';

/**
 * A dependency failure is a 503, not a 500: the request did not fail, the
 * system could not be reached. Postgres connection-class errors carry SQLSTATE
 * 08xxx / 57Pxx; the pg driver surfaces node codes like ECONNREFUSED when it
 * never reached the server. Message matching is the last-resort check.
 */
const CONNECTION_FAILURE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
]);

export function isDependencyFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && CONNECTION_FAILURE_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : '';
  return /connection (terminated|refused|reset|timed out)|terminating connection|timeout expired|ECONNREFUSED|ETIMEDOUT|driver not connected/i.test(
    message,
  );
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request & { requestId?: string }>();
    // The middleware already resolved and validated this. Reading the raw header here would
    // resurrect the `'unknown'` fallback and trust a client-supplied value unvalidated.
    const requestId = request.requestId ?? resolveRequestId(request.headers['x-request-id']);

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
    if (isDependencyFailure(exception)) {
      // Postgres or another required dependency is down. Nothing was written:
      // the transaction never began or rolled back. Fail fast, Retry-After so
      // a client backs off instead of hammering a dead database.
      this.logger.error({ requestId, path: request.url }, 'dependency unavailable');
      response.setHeader('Retry-After', '5');
      response
        .status(503)
        .json(
          toEnvelope(
            new DependencyUnavailableError().spec,
            'A required dependency is unreachable. Nothing was written; retry shortly.',
            requestId,
          ),
        );
      return;
    }

    this.logger.error({ requestId, path: request.url, err: exception }, 'unhandled exception');
    response
      .status(INTERNAL_ERROR_SPEC.status)
      .json(toEnvelope(INTERNAL_ERROR_SPEC, 'An unexpected error occurred.', requestId));
  }
}
