/**
 * The membership rules, and the session revocation that goes with them.
 *
 * These are the two things that make the membership write path safe rather than merely complete:
 *
 *  1. **A merchant cannot grant a platform role.** Without it, the one role that may act outside its
 *     own tenancy is grantable by the tenant it is meant to be outside of — an ordinary form fill
 *     escalating to PLATFORM_ADMIN.
 *  2. **The last owner cannot leave.** Removing or demoting every owner orphans the business: no one
 *     can add anyone back, mint a key, or approve a settlement, and the lockout is permanent because
 *     there is nobody left to reverse it.
 *
 * Framework-free assertions, so they test the rules and not the container. The revocation side is
 * tested by what the RULES drive: each rule is stated once, in `rules/membership.ts`, and this file
 * pins the states it is supposed to refuse.
 */

import { describe, expect, it } from 'vitest';
import {
  assertGrantableRole,
  assertRemovalAllowed,
  assertRoleChangeAllowed,
  isMerchantGrantableRole,
  wouldOrphanBusiness,
} from './membership.ts';
import { PermissionDeniedError } from '../../../common/domain-error.ts';
import { ROLE_NAMES, OWNER_ONLY_SCOPES, MERCHANT_SCOPES, type RoleName } from './roles.ts';

/** Two members: an owner and an operator. The ordinary business. */
function twoMembers() {
  return [
    { userId: 'u-owner', role: 'MERCHANT_OWNER' as RoleName },
    { userId: 'u-operator', role: 'MERCHANT_OPERATOR' as RoleName },
  ];
}

describe('which roles a merchant may grant', () => {
  it('allows both merchant roles', () => {
    expect(assertGrantableRole('MERCHANT_OWNER')).toBe('MERCHANT_OWNER');
    expect(assertGrantableRole('MERCHANT_OPERATOR')).toBe('MERCHANT_OPERATOR');
  });

  it('refuses every platform role, and says why', () => {
    // This is the security rule. A tenant that can name PLATFORM_ADMIN can hand itself a power that
    // reaches outside its own tenancy, which is exactly what a tenancy is for.
    for (const role of ROLE_NAMES) {
      if (!isMerchantGrantableRole(role)) {
        expect(() => assertGrantableRole(role), role).toThrow(PermissionDeniedError);
      }
    }
  });

  it('refuses a role name that is not a role at all', () => {
    expect(() => assertGrantableRole('SUPERUSER')).toThrow(PermissionDeniedError);
    expect(isMerchantGrantableRole('SUPERUSER')).toBe(false);
  });

  it('refuses rather than narrowing', () => {
    // A caller who asks for PLATFORM_ADMIN and silently receives MERCHANT_OPERATOR has been given a
    // weaker answer with no signal — the same failure mode as an ignored filter.
    expect(() => assertGrantableRole('PLATFORM_ADMIN')).toThrow(
      /MERCHANT_OWNER or MERCHANT_OPERATOR/,
    );
  });
});

describe('orphaning the business', () => {
  it('does not count a business orphaned while a second owner remains', () => {
    const memberships = [
      { userId: 'u-1', role: 'MERCHANT_OWNER' as RoleName },
      { userId: 'u-2', role: 'MERCHANT_OWNER' as RoleName },
    ];
    expect(wouldOrphanBusiness(memberships, 'u-1', null)).toBe(false);
  });

  it('counts it orphaned when the only owner is being removed', () => {
    expect(wouldOrphanBusiness(twoMembers(), 'u-owner', null)).toBe(true);
  });

  it('counts it orphaned when the only owner is demoted and nobody replaces them', () => {
    // The demotion form: the person keeps a membership, so the business is not literally empty, but
    // nobody left holds `members:manage` — so nobody can undo anything.
    expect(wouldOrphanBusiness(twoMembers(), 'u-owner', 'MERCHANT_OPERATOR')).toBe(true);
  });

  it('does not count it orphaned when the change PROMOTES a new owner', () => {
    expect(wouldOrphanBusiness(twoMembers(), 'u-operator', 'MERCHANT_OWNER')).toBe(false);
  });

  it('does not count it orphaned when an operator is removed', () => {
    expect(wouldOrphanBusiness(twoMembers(), 'u-operator', null)).toBe(false);
  });
});

describe('removing a member', () => {
  it('permits removing an operator while an owner remains', () => {
    expect(() => assertRemovalAllowed(twoMembers(), 'u-operator')).not.toThrow();
  });

  it('refuses removing the last owner, and names the way out', () => {
    expect(() => assertRemovalAllowed(twoMembers(), 'u-owner')).toThrow(/Promote another member/);
  });

  it('refuses removing the last owner even when they are the ONLY member', () => {
    // One-member business. Removing them deletes the last membership and the last authority.
    const solo = [{ userId: 'u-owner', role: 'MERCHANT_OWNER' as RoleName }];
    expect(() => assertRemovalAllowed(solo, 'u-owner')).toThrow(PermissionDeniedError);
  });
});

describe('changing a role', () => {
  it('permits a change that leaves an owner behind', () => {
    expect(() =>
      assertRoleChangeAllowed(twoMembers(), 'u-operator', 'MERCHANT_OWNER'),
    ).not.toThrow();
  });

  it('refuses demoting the last owner', () => {
    expect(() => assertRoleChangeAllowed(twoMembers(), 'u-owner', 'MERCHANT_OPERATOR')).toThrow(
      /last owner/,
    );
  });

  it('permits a NO-OP that keeps the same role', () => {
    // Re-PUTting the same role must not evict. The orphaning rule sees the role is unchanged.
    expect(() => assertRoleChangeAllowed(twoMembers(), 'u-owner', 'MERCHANT_OWNER')).not.toThrow();
  });

  it('is indifferent to somebody who is not a member at all', () => {
    // Not an orphaning question, and the rule does not pretend otherwise: with the target absent
    // from the list nothing changes about who the owners are. The 404 for "not a member" belongs to
    // the service, which has the row, and answering it here would make a missing-member error look
    // like a permission error.
    expect(wouldOrphanBusiness(twoMembers(), 'u-stranger', 'MERCHANT_OPERATOR')).toBe(false);
    expect(wouldOrphanBusiness(twoMembers(), 'u-stranger', null)).toBe(false);
  });
});

describe('the new scope', () => {
  it('is a merchant scope, not a platform one', () => {
    // Membership management is one account managing its own staff. Unlike hub:read or network:read
    // it is not a power over the network, so it must NOT be withheld from every merchant role.
    expect(MERCHANT_SCOPES).toContain('members:manage');
  });

  it('is owner-only, so an operator cannot enrol themselves to parity', () => {
    expect(OWNER_ONLY_SCOPES).toContain('members:manage');
  });
});
