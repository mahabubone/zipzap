import { describe, expect, it } from 'vitest';
import {
  MERCHANT_SCOPES,
  OWNER_ONLY_SCOPES,
  PLATFORM_SCOPES,
  ROLE_NAMES,
  ROLE_SCOPES,
  isRoleName,
  scopesForRole,
} from './roles.ts';
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

  it('the owner holds every MERCHANT scope, and no platform scope', () => {
    // This used to read "every scope", and it was true: the whole vocabulary was merchant-facing.
    // `hub:read` and `hub:scan` ended that. A merchant does not work a conveyor belt, and
    // `hub:scan` advances a parcel through custody — platform state, not tenant state. Granting it
    // to a merchant would hand every merchant API key the ability to drive the network machine.
    //
    // The owner is still confined to one merchantId by the principal, so holding the merchant
    // bundle in full is not over-provisioning. Tenancy is the guard's job — asserted in
    // api-principal.spec.ts, not here.
    expect([...scopesForRole('MERCHANT_OWNER')].sort()).toEqual([...MERCHANT_SCOPES].sort());
  });

  it('no merchant role can scan at a hub', () => {
    // Asserted per role rather than derived from PLATFORM_SCOPES, because the claim is about the
    // ROLES — a test that recomputes the answer stops being one the moment the list moves.
    for (const role of ['MERCHANT_OWNER', 'MERCHANT_OPERATOR'] as const) {
      expect(scopesForRole(role), `${role} may scan at a hub`).not.toContain('hub:scan');
      expect(scopesForRole(role), `${role} may read hubs`).not.toContain('hub:read');
    }
  });

  it('no merchant role can sync a rider', () => {
    // A rider's command queue is a day of somebody's work and carries COD amounts. A merchant is
    // our client, not our network partner, so their key has no business naming a rider at all.
    for (const role of ROLE_NAMES.filter(
      (r) => !['RIDER', 'HUB_OPERATOR', 'OPERATIONS_MANAGER', 'PLATFORM_ADMIN'].includes(r),
    )) {
      expect(scopesForRole(role)).not.toContain('rider:sync');
    }
  });

  it('a rider can sync, or the offline protocol has no principal at all', () => {
    // The mirror of the test above, and the one that would have caught a rider app that could read
    // its jobs and never report anything back.
    expect(scopesForRole('RIDER')).toContain('rider:sync');
  });

  it('a rider can sync, or the offline protocol has no principal at all', () => {
    // The mirror of the test above, and the one that would have caught a rider app that could read
    // its jobs and never report anything back.
    expect(scopesForRole('RIDER')).toContain('rider:sync');
  });

  it('platform roles CAN scan, or the hub console has no principal at all', () => {
    // The other half of the pair above. Without it, "no merchant can scan" is satisfied by deleting
    // the scope entirely — which is exactly what it looked like before, when a HUB_OPERATOR hit
    // the scan endpoint and got a 403 nothing explained.
    for (const role of ['HUB_OPERATOR', 'OPERATIONS_MANAGER', 'PLATFORM_ADMIN'] as const) {
      expect(scopesForRole(role), `${role} cannot scan`).toContain('hub:scan');
    }
  });

  it('a hub operator cannot create or cancel shipments', () => {
    // The reason `hub:scan` exists instead of reusing `shipments:write`. A hub terminal that could
    // write shipments would be a way for a hub employee to act inside a merchant's account.
    expect(scopesForRole('HUB_OPERATOR')).not.toContain('shipments:write');
  });

  it('platform scopes are the only ones withheld from merchants', () => {
    // A scope that is neither granted to the owner nor listed as platform-facing is a permission no
    // merchant role holds for a reason nobody wrote down. That is how one quietly stops working.
    const granted = new Set(scopesForRole('MERCHANT_OWNER'));
    for (const scope of API_SCOPES) {
      if (!granted.has(scope)) {
        expect(PLATFORM_SCOPES, `${scope} is unaccounted for`).toContain(scope);
      }
    }
  });
});
