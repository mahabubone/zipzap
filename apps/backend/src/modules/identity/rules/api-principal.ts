/**
 * The authenticated principal. Framework-free.
 *
 * Two kinds, never interchangeable: a HUMAN (session) and a MACHINE (API key). A merchant's API
 * key must not open a browser session, and a support agent's session must not work as an
 * integration credential.
 *
 * `merchantId` is DERIVED from the credential, never read from a request body. A client-supplied
 * merchantId is ignored, not trusted — a permission without tenant scope is a data breach
 * waiting for a missing WHERE.
 */

import { PermissionDeniedError, ResourceNotFoundError } from '../../../common/domain-error.ts';
import type { ApiScope } from '../../../common/scopes.ts';

export type PrincipalKind = 'human' | 'machine';

export interface ApiPrincipal {
  readonly kind: PrincipalKind;
  readonly subjectId: string;
  readonly merchantId: string | null;
  readonly scopes: readonly ApiScope[];
  readonly credentialId: string;
  /** Per-contract rate limit override (req/min), from the merchant. Absent = tier default. */
  readonly rateLimitPerMin?: number | null;
}

export function hasScope(principal: ApiPrincipal, scope: ApiScope): boolean {
  return principal.scopes.includes(scope);
}

/**
 * Throws unless the principal is scoped to this merchant.
 *
 * Called on every command that acts on tenant data. Permission without scope is the failure mode
 * this exists to prevent.
 */
export function assertTenant(principal: ApiPrincipal, merchantId: string): void {
  if (principal.merchantId === null) {
    throw new PermissionDeniedError('This principal is not scoped to a merchant.');
  }
  if (principal.merchantId !== merchantId) {
    // 404 rather than 403: a 403 confirms the resource exists, which is an enumeration oracle.
    throw new ResourceNotFoundError(`No resource ${merchantId} for this principal.`);
  }
}
