/**
 * Users, memberships, and picking the active business. Framework-free.
 *
 * A LOGIN is a person. A MEMBERSHIP is that person's role inside one merchant. Those were the same
 * thing until `identity.users` existed, which is why one login could not act inside two businesses:
 * there was nowhere to put the second one.
 *
 * Membership HAS a write path since 2026-10-11: `membership.controller.ts` invites by email, changes
 * a role, and removes a member, and all three revoke the target's sessions. What is still absent is
 * a password reset and account suspension — see `rules/membership.ts` for the two rules that keep the
 * write path from escalating past a merchant's own tenancy.
 */

import { PermissionDeniedError } from '../../../common/domain-error.ts';
import { isRoleName, scopesForRole, type RoleName } from './roles.ts';

/** One row of `identity.user_merchants`. */
export interface Membership {
  readonly merchantId: string;
  readonly role: RoleName;
}

/** A person, with the memberships that decide what they may do. */
export interface PrincipalMemberships {
  readonly userId: string;
  readonly email: string;
  readonly memberships: readonly Membership[];
}

/**
 * The business a request acts inside.
 *
 * Preference order, and the reasoning is the whole function:
 *
 *  1. an explicitly requested business the user belongs to wins;
 *  2. otherwise the FIRST membership, deterministically ordered — two users with identical
 *     memberships must not get different default businesses on different requests, or a client
 *     that omits the header reads someone else's data.
 *
 * A requested business the user does NOT belong to is refused rather than ignored. Ignoring it
 * would silently serve the default business, so a client with a stale id would get a 200 full of
 * another store's shipments — the worst possible failure, because it looks like success.
 */
export function resolveActiveMerchant(
  user: PrincipalMemberships,
  requestedMerchantId?: string | null,
): string {
  if (requestedMerchantId) return assertMember(user, requestedMerchantId);

  const ordered = [...user.memberships].sort((a, b) => a.merchantId.localeCompare(b.merchantId));
  const first = ordered[0];
  if (!first) throw new PermissionDeniedError('This user belongs to no business.');
  return first.merchantId;
}

/** Throws unless the user is a member. Same 404-not-403 reasoning as `assertTenant`. */
export function assertMember(user: PrincipalMemberships, merchantId: string): string {
  if (user.memberships.some((m) => m.merchantId === merchantId)) return merchantId;
  throw new PermissionDeniedError(`No access to business ${merchantId}.`);
}

/**
 * The role for one business, NOT the user's role everywhere.
 *
 * A membership row whose role the vocabulary does not recognise fails closed. The column has a
 * CHECK, so this is unreachable — which is the point: widening the role vocabulary must never
 * silently widen an already-issued token.
 */
export function roleForMerchant(user: PrincipalMemberships, merchantId: string): RoleName {
  const membership = user.memberships.find((m) => m.merchantId === merchantId);
  if (!membership) throw new PermissionDeniedError(`No access to business ${merchantId}.`);
  if (!isRoleName(membership.role)) {
    throw new PermissionDeniedError(`Unrecognised role for business ${merchantId}.`);
  }
  return membership.role;
}

/**
 * Every business this user may act inside.
 *
 * `ponytail:` a platform role (PLATFORM_ADMIN, OPERATIONS_MANAGER, SUPPORT_AGENT) is not scoped to
 * one merchant by membership, so `merchantIds` does not include "all merchants" — a caller that
 * needs that reads across merchants explicitly rather than receiving a wildcard the tenant
 * predicates would then have to special-case.
 */
export function merchantIdsOf(user: PrincipalMemberships): readonly string[] {
  return user.memberships.map((m) => m.merchantId);
}

/** The scopes for one business: the membership's role bundle. Never the full vocabulary. */
export function scopesForMembership(
  user: PrincipalMemberships,
  merchantId: string,
): readonly string[] {
  return scopesForRole(roleForMerchant(user, merchantId));
}
