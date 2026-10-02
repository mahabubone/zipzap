/**
 * The §87 error envelope.
 *
 * Framework-free on purpose: this is pure mapping logic and belongs where it can be unit
 * tested without loading NestJS. See docs/api/errors.md.
 */

import type { DomainErrorSpec } from './domain-error';

export interface ErrorEnvelope {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  request_id: string;
}

export const INTERNAL_ERROR_SPEC: DomainErrorSpec = {
  code: 'INTERNAL_ERROR',
  status: 500,
  title: 'Internal server error',
};

/** Stable, derived from the code so the same failure always has the same URI. */
export function problemType(code: string): string {
  return `https://api.zipzap.example/errors/${code.toLowerCase().replaceAll('_', '-')}`;
}

export function toEnvelope(
  spec: DomainErrorSpec,
  detail: string,
  requestId: string,
): ErrorEnvelope {
  return {
    type: problemType(spec.code),
    title: spec.title,
    status: spec.status,
    code: spec.code,
    detail,
    request_id: requestId,
  };
}
