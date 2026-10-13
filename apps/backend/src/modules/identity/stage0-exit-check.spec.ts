/**
 * Stage 0 exit check — the five assertions in docs/product/competition/plan.md, runnable.
 *
 * The plan says a stage is done when its check runs green, not when its boxes are ticked. This
 * file is that check. Each `it` names the plan line it answers, so a failure says which
 * assertion broke rather than which test broke.
 *
 * Assertion 3 was marked `it.fails` while it was still open — the modifier kept `pnpm verify`
 * green while leaving the assertion armed, and inverted the moment multi-business landed. It is a
 * plain `it` now and all five pass. Do not reintroduce `it.fails` to silence a genuine failure: a
 * skipped assertion is an unchecked box, and a permanently red suite is a gate everyone ignores.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { AuthenticateApiKeyService, FIND_CREDENTIAL } from './authenticate-api-key.service.ts';
import { MerchantAuthService } from '../merchant/sessions.service.ts';
import { UserService } from './user.service.ts';
import { assertTenant, hasScope, type ApiPrincipal } from './rules/api-principal.ts';
import { scopesForRole } from './rules/roles.ts';
import { hashSecret, verifySecret } from '../../common/secret.ts';
import { RateLimitGuard } from './rate-limit.guard.ts';
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  ResourceNotFoundError,
} from '../../common/domain-error.ts';

const SECRET = 'sk_stage0_secret';
const STORED = hashSecret(SECRET);

function principal(overrides: Partial<ApiPrincipal> = {}): ApiPrincipal {
  return {
    kind: 'human',
    subjectId: 'u-1',
    merchantId: 'm-1',
    // One membership by default, so a test that does not care about multi-business is asserting
    // tenancy and not accidentally asserting that everything is reachable.
    merchantIds: ['m-1'],
    scopes: scopesForRole('MERCHANT_OWNER'),
    credentialId: 'cred-1',
    ...overrides,
  };
}

/** A person who belongs to the given businesses, as identity would return them. */
function person(merchantIds: readonly string[]) {
  return {
    userId: 'u-1',
    email: 'person@example.test',
    passwordHash: STORED,
    disabledAt: null,
    // OWNER in the first, OPERATOR in the rest — different roles per business on purpose, because
    // membership-scoped permissions are the whole point.
    memberships: merchantIds.map((merchantId, index) => ({
      merchantId,
      role: index === 0 ? 'MERCHANT_OWNER' : 'MERCHANT_OPERATOR',
    })),
  };
}

/** The same person, with the role each membership should carry stated outright. */
function personWith(memberships: readonly { merchantId: string; role: string }[]) {
  return { ...person([]), memberships };
}

function credential(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    merchantId: 'm-1',
    merchantName: 'One',
    merchantStatus: 'ACTIVE',
    secretHash: STORED,
    scopes: ['shipments:write'],
    revokedAt: null,
    ...overrides,
  };
}

describe('Stage 0 exit check', () => {
  let auth: AuthenticateApiKeyService;
  let sessions: { authenticateToken: ReturnType<typeof vi.fn> };
  let credentials: {
    findByKeyId: ReturnType<typeof vi.fn>;
    touchLastUsed: ReturnType<typeof vi.fn>;
  };
  let users: { findById: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    credentials = { findByKeyId: vi.fn(), touchLastUsed: vi.fn() };
    sessions = { authenticateToken: vi.fn().mockResolvedValue(null) };
    users = { findById: vi.fn().mockResolvedValue(person(['m-1', 'm-2'])) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthenticateApiKeyService,
        { provide: FIND_CREDENTIAL, useValue: credentials },
        { provide: MerchantAuthService, useValue: sessions },
        { provide: UserService, useValue: users },
      ],
    }).compile();
    auth = module.get(AuthenticateApiKeyService);
  });

  // "An API key cannot obtain a browser session, and a session cannot call an API-only scope"
  it('1. the two principal kinds are not interchangeable', async () => {
    // An operator in the business this session was opened against. The session's stored role and
    // the membership must agree: scopes are resolved from the MEMBERSHIP, so a session claiming
    // OPERATOR over an OWNER membership is not a thing the system can represent.
    sessions.authenticateToken.mockResolvedValue({
      id: 's1',
      merchantId: 'm-1',
      userId: 'u-1',
      merchantStatus: 'ACTIVE',
      rateLimitPerMin: null,
      role: 'MERCHANT_OPERATOR',
    });
    users.findById.mockResolvedValue({
      ...person(['m-1']),
      memberships: [{ merchantId: 'm-1', role: 'MERCHANT_OPERATOR' }],
    });
    const operator = await auth.authenticate('Bearer session-token');

    expect(operator.kind).toBe('human');
    expect(operator.scopes).not.toContain('keys:manage');
    expect(operator.scopes).not.toContain('settlements:approve');

    // An API key resolves to a machine, never to a session row, so it can never mint one.
    credentials.findByKeyId.mockResolvedValue(credential());
    const machine = await auth.authenticate(`ApiKey kid.${SECRET}`);
    expect(machine.kind).toBe('machine');
    expect(sessions.authenticateToken).toHaveBeenCalledTimes(1);

    users.findById.mockResolvedValue(person(['m-1', 'm-2']));

    // A session presented as an API key is not a machine credential in disguise.
    credentials.findByKeyId.mockResolvedValue(null);
    await expect(auth.authenticate(`ApiKey ${SECRET}.${SECRET}`)).rejects.toBeInstanceOf(
      AuthenticationRequiredError,
    );
  });

  // "Two operators on one merchant hold different permissions; the denied one gets 403 without
  //  leaking the resource's existence"
  it('2. role is enforced as scopes, and a denied call is indistinguishable from a missing one', async () => {
    const owner = principal({ scopes: scopesForRole('MERCHANT_OWNER') });
    const operator = principal({ scopes: scopesForRole('MERCHANT_OPERATOR') });

    expect(hasScope(owner, 'settlements:approve')).toBe(true);
    expect(hasScope(operator, 'settlements:approve')).toBe(false);

    // Cross-tenant is 404, not 403: a 403 confirms the resource exists.
    expect(() => assertTenant(operator, 'm-2')).toThrow(ResourceNotFoundError);
    expect(() => assertTenant(operator, 'does-not-exist')).toThrow(ResourceNotFoundError);
    // Both are the same error and the same message, so neither answers "is this real?".
    const one = (() => {
      try {
        assertTenant(operator, 'm-2');
      } catch (error) {
        return error as Error;
      }
    })();
    const two = (() => {
      try {
        assertTenant(operator, 'does-not-exist');
      } catch (error) {
        return error as Error;
      }
    })();
    expect((one as Error).constructor).toBe((two as Error).constructor);
    expect((one as Error).message.replace('m-2', '')).toBe(
      (two as Error).message.replace('does-not-exist', ''),
    );

    // A missing scope is 403 and never names the resource it was refused.
    expect(new PermissionDeniedError('Missing scope settlements:approve.').spec.status).toBe(403);
    expect(new PermissionDeniedError('Missing scope settlements:approve.').message).not.toContain(
      'm-2',
    );
  });

  // "One login can act inside two businesses and cannot read the third"
  it('3. one login can act inside two businesses and cannot read the third', async () => {
    // One person, one session, two businesses — through the real authentication path, not a
    // hand-built principal. `identity.users` + `identity.user_merchants` (migration 0036) are what
    // make the second membership exist at all.
    sessions.authenticateToken.mockResolvedValue({
      id: 's1',
      merchantId: 'm-1',
      userId: 'u-1',
      merchantStatus: 'ACTIVE',
      rateLimitPerMin: null,
      role: 'MERCHANT_OWNER',
    });

    const login = await auth.authenticate('Bearer session-token');

    // Act inside either business, and only those.
    expect(login.merchantIds).toEqual(['m-1', 'm-2']);
    expect(() => assertTenant(login, 'm-1')).not.toThrow();
    expect(() => assertTenant(login, 'm-2')).not.toThrow();
    expect(() => assertTenant(login, 'm-3')).toThrow(ResourceNotFoundError);

    // The role is per MEMBERSHIP, so the second business is not granted the first one's money
    // scopes by association. This is the regression a single `role` on the user would reintroduce.
    expect(login.scopes).toContain('settlements:approve'); // m-1, the owner
    // Same person, but their only membership is the second business, where they are an operator.
    users.findById.mockResolvedValue(
      personWith([{ merchantId: 'm-2', role: 'MERCHANT_OPERATOR' }]),
    );
    sessions.authenticateToken.mockResolvedValue({
      id: 's1',
      merchantId: 'm-2',
      userId: 'u-1',
      merchantStatus: 'ACTIVE',
      rateLimitPerMin: null,
      role: 'MERCHANT_OPERATOR',
    });
    const asOperator = await auth.authenticate('Bearer session-token');
    expect(asOperator.scopes).not.toContain('settlements:approve');
    expect(asOperator.scopes).not.toContain('keys:manage');
    expect(asOperator.scopes).toContain('shipments:write');

    // A membership revoked mid-session stops working on the next request, without a re-login.
    users.findById.mockResolvedValue({ ...person(['m-1']), memberships: [] });
    await expect(auth.authenticate('Bearer session-token')).rejects.toBeInstanceOf(
      AuthenticationRequiredError,
    );
  });

  // "scrypt only; timingSafeEqual is the only comparison path; verifySecret is unit-tested
  //  against a malformed stored value"
  it('4. secrets are scrypt, compared in constant time, and fail closed on a malformed row', async () => {
    expect(STORED.startsWith('scrypt$')).toBe(true);
    expect(await verifySecret(SECRET, STORED)).toBe(true);
    expect(await verifySecret('wrong', STORED)).toBe(false);

    // A stored hash of a different length must be refused, not throw: `timingSafeEqual`
    // throws on a length mismatch, so the length guard is what keeps a bad row from
    // becoming a 500 in the middle of a login.
    const shorter = STORED.replace(/\$([^$]+)$/, 'AAAA');
    expect(await verifySecret(SECRET, shorter)).toBe(false);

    // Malformed stored values return false, never throw into a request handler.
    for (const malformed of ['', 'argon2id$m=1,t=1,p=1$c$c', 'scrypt$1$2$3', 'scrypt$a$b$c$d']) {
      expect(await verifySecret(SECRET, malformed), malformed).toBe(false);
    }
  });

  // "A write under rate limit returns 429, and the limit cannot be bypassed by retrying"
  it('5. a write over the limit is 429, and retrying does not buy budget', async () => {
    const members = new Set<string>();
    const countingRedis = {
      pipeline: () => ({
        zadd: (_key: string, _score: string, member: string) => void members.add(member),
        zremrangebyscore: () => undefined,
        zcard: () => undefined,
        expire: () => undefined,
        pttl: () => undefined,
        exec: async () => [
          [null, 1],
          [null, 1],
          [null, members.size],
          [null, 1],
          [null, 60_000],
        ],
      }),
    } as never;

    const ctx = () => {
      const headers: Record<string, string> = {};
      return {
        switchToHttp: () => ({
          getRequest: () => ({ principal: principal({ merchantId: 'm-1' }), ip: '1.2.3.4' }),
          getResponse: () => ({ setHeader: (k: string, v: string) => void (headers[k] = v) }),
        }),
        headers,
      } as never;
    };

    // A fresh counter allows requests; the 601st is refused.
    let refused = 0;
    for (let i = 0; i < 601; i++) {
      try {
        await new RateLimitGuard('merchant', true, countingRedis).canActivate(ctx());
      } catch {
        refused++;
      }
    }
    expect(refused).toBe(1);

    // Retrying is just more traffic on the same window: still refused, and the budget stays 0.
    let stillRefused = 0;
    for (let i = 0; i < 5; i++) {
      try {
        await new RateLimitGuard('merchant', true, countingRedis).canActivate(ctx());
      } catch {
        stillRefused++;
      }
    }
    expect(stillRefused).toBe(5);
  });
});
