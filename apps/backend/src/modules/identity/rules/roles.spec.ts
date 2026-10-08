import { describe, expect, it } from 'vitest';
import { OWNER_ONLY_SCOPES, ROLE_NAMES, ROLE_SCOPES, isRoleName, scopesForRole } from './roles.ts';
import { API_SCOPES } from '../../../common/scopes.ts';

/**
 * Role bundles, asserted as authorization policy rather than as data.
 *
 * The test that matters is `operator cannot reach money or credentials`: it is the one asserting
 * the security decision this file exists to record.
 */

describe('role bundles', () => {
  it('every scope a bundle grants is a real scope', () => {
    for (const role of ROLE_NAMES) {
      for (const scope of ROLE_SCOPES[role]) {
        expect(API_SCOPES, `${role} grants unknown scope ${scope}`).toContain(scope);
      }
    }
  });

  it('recognises exactly the declared role names', () => {
    for (const role of ROLE_NAMES) expect(isRoleName(role)).toBe(true);
    expect(isRoleName('merchant_owner')).toBe(false); // case matters — it is a stored value
    expect(isRoleName('')).toBe(false);
  });

  it('an operator cannot move money or mint credentials', () => {
    for (const scope of OWNER_ONLY_SCOPES) {
      expect(scopesForRole('MERCHANT_OPERATOR')).not.toContain(scope);
      expect(scopesForRole('MERCHANT_OWNER')).toContain(scope);
    }
  });

  it('an operator can still do the job — everything else merchant-facing', () => {
    const operator = scopesForRole('MERCHANT_OPERATOR');
    expect(operator).toContain('shipments:read');
    expect(operator).toContain('shipments:write');
    expect(operator).toContain('returns:write');
    expect(operator).toContain('cod:read');
  });

  it('an operator holds strictly fewer scopes than the owner', () => {
    expect(scopesForRole('MERCHANT_OPERATOR').length).toBeLessThan(
      scopesForRole('MERCHANT_OWNER').length,
    );
  });

  it('support cannot read a merchant cash position', () => {
    expect(scopesForRole('SUPPORT_AGENT')).not.toContain('cod:read');
    expect(scopesForRole('SUPPORT_AGENT')).not.toContain('settlements:read');
  });

  it('only the owner holds keys:manage among merchant roles', () => {
    const holders = ROLE_NAMES.filter((r) => scopesForRole(r).includes('keys:manage'));
    expect([...holders].sort()).toEqual(['MERCHANT_OWNER', 'PLATFORM_ADMIN']);
  });

  it('hub staff see no money at all', () => {
    expect(scopesForRole('HUB_OPERATOR')).not.toContain('cod:read');
    expect(scopesForRole('HUB_OPERATOR')).not.toContain('settlements:read');
  });

  it('a rider cannot read merchant shipments or COD', () => {
    expect(scopesForRole('RIDER')).not.toContain('shipments:read');
    expect(scopesForRole('RIDER')).not.toContain('cod:read');
  });

  it('every role grants something — an empty bundle is a typo, not a role', () => {
    for (const role of ROLE_NAMES) {
      expect(scopesForRole(role).length, `${role} grants nothing`).toBeGreaterThan(0);
    }
  });

  it('the owner holds every scope, because the whole vocabulary is merchant-facing', () => {
    // Every entry in API_SCOPES is something a merchant does. So the owner holding all of them is
    // correct, not over-provisioning: the owner is still confined to one merchantId by the
    // principal. Tenancy is the guard's job — asserted in api-principal.spec.ts, not here.
    expect([...scopesForRole('MERCHANT_OWNER')].sort()).toEqual([...API_SCOPES].sort());
  });
});
