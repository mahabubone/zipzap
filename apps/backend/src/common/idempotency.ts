/**
 * Idempotency. Pure key and hash derivation — the database mechanics live in the store.
 *
 * See docs/api/idempotency.md and docs/ADR/0010-idempotency.md.
 */

import { createHash } from 'node:crypto';

/** Canonical request body fingerprint. Key order must not change the hash. */
export function hashRequest(body: unknown): string {
  return createHash('sha256').update(canonicalize(body)).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(',')}}`;
}

/**
 * The composite primary key. Scoped per operation class and per merchant, so two merchants
 * using `order-1` are two different requests and one can never see the other's response.
 */
export interface IdempotencyScope {
  readonly scope: string;
  readonly merchantId: string | null;
  readonly key: string;
}

export function scopeKey(scope: IdempotencyScope): string {
  return `${scope.scope}:${scope.merchantId ?? 'anonymous'}:${scope.key}`;
}

export type IdempotencyDecision =
  | { readonly outcome: 'proceed' }
  | { readonly outcome: 'replay'; readonly responseCode: number; readonly responseBody: unknown }
  | { readonly outcome: 'key_reuse' };

export interface StoredIdempotencyRecord {
  readonly requestHash: string;
  readonly responseCode: number | null;
  readonly responseBody: unknown;
}

/**
 * A conflict on the same key with a different body is a client bug worth surfacing.
 * Silently replaying the first response would convince the merchant their second,
 * different request succeeded.
 */
export function decide(
  existing: StoredIdempotencyRecord,
  requestHash: string,
): IdempotencyDecision {
  if (existing.requestHash !== requestHash) return { outcome: 'key_reuse' };
  if (existing.responseCode === null) {
    // The key is committed but the operation has not finished — a concurrent request is
    // still in flight. Treat as a duplicate rather than running the work twice.
    return { outcome: 'replay', responseCode: 409, responseBody: { code: 'DUPLICATE_REQUEST' } };
  }
  return {
    outcome: 'replay',
    responseCode: existing.responseCode,
    responseBody: existing.responseBody,
  };
}
