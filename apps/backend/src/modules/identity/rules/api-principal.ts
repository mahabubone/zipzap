/**
 * The authenticated principal. Framework-free.
 *
 * Two kinds, never interchangeable: a HUMAN (session) and a MACHINE (API key). A merchant's API
 * key must not open a browser session, and a support agent's session must not work as an
 * integration credential.
 *
 * `merchantId` is the ACTIVE business — the one this request acts inside — and it is DERIVED from
 * the credential, never read from a request body. A client-supplied merchantId is ignored, not
 * trusted; a permission without tenant scope is a data breach waiting for a missing WHERE.
 *
 * `merchantIds` is every business this principal may act inside, and it exists because a login is
 * a PERSON who may hold several memberships. `merchantId` is a selection within that set, resolved
 * from the memberships at authentication; it is not the boundary itself. Before `identity.users`
 * existed there was no set, so a second business was not merely unimplemented — it was
 * unrepresentable.
 */

import { PermissionDeniedError, ResourceNotFoundError } from '../../../common/domain-error.ts';
import type { ApiScope } from '../../../common/scopes.ts';

export type PrincipalKind = 'human' | 'machine';

export interface ApiPrincipal {
  readonly kind: PrincipalKind;
  readonly subjectId: string;
  /** The business this request acts inside. Always one of `merchantIds`. */
  readonly merchantId: string | null;
  /**
   * Every business this principal may act inside. A machine has exactly one — an API key is issued
   * to one merchant and cannot be widened by a request. A human has one per membership.
   */
  readonly merchantIds: readonly string[];
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
 *
 * Membership, not equality: a principal whose memberships are [m-1, m-2] may act in either, and
 * only in those. A merchant outside the set gets the same 404 as one that does not exist, because
 * a 403 confirms the resource exists and turns this into an enumeration oracle.
 */
export function assertTenant(principal: ApiPrincipal, merchantId: string): void {
  if (principal.merchantId === null) {
    throw new PermissionDeniedError('This principal is not scoped to a merchant.');
  }
  if (!principal.merchantIds.includes(merchantId)) {
    // 404 rather than 403: a 403 confirms the resource exists, which is an enumeration oracle.
    throw new ResourceNotFoundError(`No resource ${merchantId} for this principal.`);
  }
}
