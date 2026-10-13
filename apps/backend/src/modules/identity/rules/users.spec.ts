import { describe, expect, it } from 'vitest';
import {
  assertMember,
  merchantIdsOf,
  resolveActiveMerchant,
  roleForMerchant,
  scopesForMembership,
  type PrincipalMemberships,
} from './users.ts';
import { PermissionDeniedError } from '../../../common/domain-error.ts';

/**
 * Membership resolution. The tests that matter are the two refusals: an unknown business and a
 * business the user does not belong to must be indistinguishable, and a requested business must
 * never be silently swapped for the default one.
 */

function user(overrides: Partial<PrincipalMemberships> = {}): PrincipalMemberships {
  return {
    userId: 'u-1',
    email: 'person@example.test',
    memberships: [
      { merchantId: 'm-1', role: 'MERCHANT_OWNER' },
      { merchantId: 'm-2', role: 'MERCHANT_OPERATOR' },
    ],
    ...overrides,
  };
}

describe('resolveActiveMerchant', () => {
  it('honours a requested business the user belongs to', () => {
    expect(resolveActiveMerchant(user(), 'm-2')).toBe('m-2');
  });

  it('defaults to the FIRST membership, deterministically, not the insertion order', () => {
    const reversed = user({
      memberships: [
        { merchantId: 'm-2', role: 'MERCHANT_OPERATOR' },
        { merchantId: 'm-1', role: 'MERCHANT_OWNER' },
      ],
    });
    // Two users with identical memberships must not get different defaults on different requests.
    expect(resolveActiveMerchant(reversed)).toBe('m-1');
    expect(resolveActiveMerchant(user())).toBe('m-1');
  });

  it('refuses a business the user does not belong to instead of falling back to the default', () => {
    // The dangerous alternative is ignoring the bad id and serving the default business: a client
    // with a stale id would get a 200 full of another store's shipments.
    expect(() => resolveActiveMerchant(user(), 'm-3')).toThrow(PermissionDeniedError);
  });

  it('refuses a user with no memberships rather than defaulting to nothing', () => {
    expect(() => resolveActiveMerchant(user({ memberships: [] }))).toThrow(
      /belongs to no business/,
    );
  });
});

describe('membership scoping', () => {
  it('reads the role per membership, not per user', () => {
    expect(roleForMerchant(user(), 'm-1')).toBe('MERCHANT_OWNER');
    expect(roleForMerchant(user(), 'm-2')).toBe('MERCHANT_OPERATOR');
  });

  it("scopes a membership to its own business — the owner's money scopes do not leak sideways", () => {
    const owner = scopesForMembership(user(), 'm-1');
    const operator = scopesForMembership(user(), 'm-2');

    expect(owner).toContain('settlements:approve');
    expect(operator).not.toContain('settlements:approve');
    expect(operator).not.toContain('keys:manage');
  });

  it('lists every business the user may act inside', () => {
    expect([...merchantIdsOf(user())].sort()).toEqual(['m-1', 'm-2']);
  });

  it('refuses a role the vocabulary does not recognise rather than defaulting', () => {
    const broken = user({
      memberships: [{ merchantId: 'm-1', role: 'SUPERUSER' as never }],
    });
    expect(() => roleForMerchant(broken, 'm-1')).toThrow(/Unrecognised role/);
  });

  it('an unknown business and an unheld business are refused identically', () => {
    const one = (() => {
      try {
        assertMember(user(), 'm-3');
      } catch (error) {
        return error as Error;
      }
    })();
    const two = (() => {
      try {
        assertMember(user(), 'no-such-merchant');
      } catch (error) {
        return error as Error;
      }
    })();
    expect((one as Error).constructor).toBe((two as Error).constructor);
    expect((one as Error).message.replace('m-3', '')).toBe(
      (two as Error).message.replace('no-such-merchant', ''),
    );
  });
});
