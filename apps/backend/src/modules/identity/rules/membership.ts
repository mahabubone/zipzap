/**
 * The rules for changing a membership. Framework-free, and the security decisions live here.
 *
 * Until this file existed there was no way to add, change or remove a membership at all: every row in
 * `identity.user_merchants` was written by the seed, and `UserService` only reads. That gap is larger
 * than the session-revocation bug it came with — `MerchantAuthService.revokeSessionsForUser` needed a
 * caller to be worth anything, and a business with no way to remove a person is a business that cannot
 * respond to someone leaving.
 *
 * Two decisions in this file are security decisions, not convenience ones, and both are the
 * fail-closed direction:
 *
 *  1. **A merchant cannot mint a platform role.** `MERCHANT_OWNER` is not `PLATFORM_ADMIN`. Without
 *     this, the one role that may act outside its own tenancy would be grantable by the tenant it is
 *     supposed to be outside of — a privilege-escalation path that starts with an ordinary form fill.
 *  2. **The last owner cannot be removed or demoted.** Removing every owner orphans the business: no
 *     one can then add anyone back, mint an API key, or approve a settlement, and the lockout is
 *     permanent because there is nobody left to reverse it.
 */

import { PermissionDeniedError } from '../../../common/domain-error.ts';
import { isRoleName, type RoleName } from './roles.ts';

/**
 * Roles a merchant may grant to one of their own members.
 *
 * The platform roles are absent deliberately. `PLATFORM_ADMIN`, `OPERATIONS_MANAGER`,
 * `HUB_OPERATOR`, `SUPPORT_AGENT` and `RIDER` are all powers over the network or over other
 * merchants, and a merchant granting one is a tenant hand-writing itself out of its tenancy.
 */
export const MERCHANT_GRANTABLE_ROLES = ['MERCHANT_OWNER', 'MERCHANT_OPERATOR'] as const;

export type MerchantGrantableRole = (typeof MERCHANT_GRANTABLE_ROLES)[number];

export function isMerchantGrantableRole(value: string): value is MerchantGrantableRole {
  return (MERCHANT_GRANTABLE_ROLES as readonly string[]).includes(value);
}

/**
 * The role a membership may be set to, checked before anything is written.
 *
 * Throws rather than narrowing: a caller who asks for `PLATFORM_ADMIN` and silently receives
 * `MERCHANT_OPERATOR` has been given a weaker version of what they asked for with no signal, which is
 * the same failure mode as an ignored filter.
 */
export function assertGrantableRole(role: string): MerchantGrantableRole {
  if (!isRoleName(role) || !isMerchantGrantableRole(role)) {
    throw new PermissionDeniedError(
      `A merchant may only grant ${MERCHANT_GRANTABLE_ROLES.join(' or ')}.`,
    );
  }
  return role;
}

/**
 * Whether a membership change would leave the business with no owner.
 *
 * Counted from the roles that still hold `members:manage` after the change, because the owner-only
 * scope is what can reverse a removal. A business whose only remaining owner is being demoted to
 * operator has one member who can no longer undo anything.
 */
export function wouldOrphanBusiness(
  memberships: readonly { readonly role: RoleName; readonly userId: string }[],
  targetUserId: string,
  nextRole: RoleName | null,
): boolean {
  const remaining = memberships.filter((m) => m.userId !== targetUserId);
  const survivingOwners = remaining.filter((m) => m.role === 'MERCHANT_OWNER').length;
  const targetBecomesOwner = nextRole === 'MERCHANT_OWNER';
  return survivingOwners === 0 && !targetBecomesOwner;
}

/** The removal form: nobody is being promoted in the same breath. */
export function assertRemovalAllowed(
  memberships: readonly { readonly role: RoleName; readonly userId: string }[],
  targetUserId: string,
): void {
  if (wouldOrphanBusiness(memberships, targetUserId, null)) {
    throw new PermissionDeniedError(
      'This is the last owner of the business. Promote another member before removing them.',
    );
  }
}

/** The demotion form: the target keeps a membership, but possibly a weaker one. */
export function assertRoleChangeAllowed(
  memberships: readonly { readonly role: RoleName; readonly userId: string }[],
  targetUserId: string,
  nextRole: RoleName,
): void {
  if (wouldOrphanBusiness(memberships, targetUserId, nextRole)) {
    throw new PermissionDeniedError(
      'Demoting the last owner would leave the business with nobody who can manage members. ' +
        'Promote another member first.',
    );
  }
}
