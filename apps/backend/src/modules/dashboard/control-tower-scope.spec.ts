/**
 * The control tower's two unguarded endpoints.
 *
 * `GET /v1/control-tower/live-counts` and `GET /v1/control-tower/report` were guarded by
 * `ApiKeyGuard` alone. That guard authenticates and does nothing else, so a merchant API key
 * received the whole network: every merchant's shipment counts, COD expected/collected/settled
 * in poisha, return rates, rider work and hub volumes. Confirmed against a running server
 * before the fix — HTTP 200 with `expectedMinor: 117306000`.
 *
 * The scope was missing rather than merely unenforced (`0042-RiderSyncScope` fixed the same
 * class of hole for the rider queue), so these tests read the guard metadata off the real
 * controllers rather than re-deriving the intent. A test that re-derives the authorization
 * scheme is a test that stops asserting anything the moment the scheme moves.
 */

import { describe, expect, it } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ScopeGuard } from '../identity/api-key.guard.ts';
import { ROLE_SCOPES } from '../identity/rules/roles.ts';
import { DashboardController } from './dashboard.controller.ts';
import { ReportController } from './report.controller.ts';

/** Every ScopeGuard bound to a handler on the prototype, flattened. */
function scopesOn(prototype: object, handler: string): string[] {
  const guards: unknown[] =
    Reflect.getMetadata(GUARDS_METADATA, prototype[handler as keyof typeof prototype]) ?? [];
  return guards
    .filter((guard): guard is ScopeGuard => guard instanceof ScopeGuard)
    .map((guard) => Reflect.get(guard as object, 'required') as string);
}

describe('control tower endpoints name a scope', () => {
  it('live-counts requires network:read', () => {
    expect(scopesOn(DashboardController.prototype, 'getLiveCounts')).toContain('network:read');
  });

  it('the report requires network:read', () => {
    expect(scopesOn(ReportController.prototype, 'getReport')).toContain('network:read');
  });

  // The bug was the *absence* of a guard, so assert the shape rather than one string: a second
  // handler on either controller is covered by the same claim and would otherwise slip past.
  it('every handler on both controllers is guarded, not just the two named here', () => {
    for (const [name, prototype] of [
      ['DashboardController', DashboardController.prototype],
      ['ReportController', ReportController.prototype],
    ] as const) {
      const handlers = Object.getOwnPropertyNames(prototype).filter(
        (key) => key !== 'constructor' && typeof (prototype as never)[key] === 'function',
      );
      for (const handler of handlers) {
        expect(scopesOn(prototype, handler), `${name}.${handler}`).not.toHaveLength(0);
      }
    }
  });
});

describe('network:read is not a merchant power', () => {
  it('no merchant role holds it', () => {
    for (const role of ['MERCHANT_OWNER', 'MERCHANT_OPERATOR'] as const) {
      expect(ROLE_SCOPES[role]).not.toContain('network:read');
    }
  });

  it('the roles that run the network do hold it', () => {
    // The other half of the same claim: guarding the endpoint without granting the scope to the
    // people who legitimately run it would close the breach and break the ops console.
    for (const role of ['PLATFORM_ADMIN', 'OPERATIONS_MANAGER'] as const) {
      expect(ROLE_SCOPES[role]).toContain('network:read');
    }
  });
});
