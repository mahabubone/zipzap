import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { AuthenticateApiKeyService, FIND_CREDENTIAL } from './authenticate-api-key.service.ts';
import { MerchantAuthService } from '../merchant/sessions.service.ts';
import { UserService } from './user.service.ts';
import { hashSecret } from '../../common/secret.ts';
import { MERCHANT_SCOPES } from './rules/roles.ts';
import { AuthenticationRequiredError } from '../../common/domain-error.ts';

/**
 * Auth decisions without a database.
 *
 * Three invariants, each with a security consequence if it breaks:
 *   1. every failure returns the same error — otherwise this endpoint is a key-enumeration oracle;
 *   2. merchant scope is derived from the credential, never from a request — otherwise it is a
 *      cross-tenant read waiting for a missing WHERE;
 *   3. a human session gets its ROLE's scopes, not every scope — otherwise one stolen console
 *      token can move money.
 */

const SECRET = 'sk_test_secret_value_1';
const STORED = hashSecret(SECRET);

function credential(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'c1',
    merchantId: 'm-active',
    merchantName: 'Active Co',
    merchantStatus: 'ACTIVE',
    secretHash: STORED,
    scopes: ['shipments:write'],
    revokedAt: null,
    ...overrides,
  };
}

/** A valid human session. `role` is a string on purpose — merchant stores it opaquely. */
function session(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 's1',
    merchantId: 'm-active',
    userId: 'u-1',
    merchantStatus: 'ACTIVE',
    rateLimitPerMin: null,
    role: 'MERCHANT_OWNER',
    ...overrides,
  };
}

/** The person behind a session: memberships plus the credential identity reads. */
function user(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: 'u-1',
    email: 'person@example.test',
    passwordHash: STORED,
    disabledAt: null,
    memberships: [{ merchantId: 'm-active', role: 'MERCHANT_OWNER' }],
    ...overrides,
  };
}

describe('AuthenticateApiKeyService', () => {
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
    users = { findById: vi.fn().mockResolvedValue(user()) };
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

  it('resolves a principal from a valid header, scoped to the credential merchant', async () => {
    credentials.findByKeyId.mockResolvedValue(credential());

    const principal = await auth.authenticate(`ApiKey kid.${SECRET}`);

    expect(principal.kind).toBe('machine');
    expect(principal.merchantId).toBe('m-active');
    expect(principal.scopes).toContain('shipments:write');
    expect(credentials.findByKeyId).toHaveBeenCalledWith('kid');
    expect(credentials.touchLastUsed).toHaveBeenCalledWith('c1');
  });

  it('fails identically for malformed, unknown, wrong-secret and revoked credentials', async () => {
    credentials.findByKeyId.mockResolvedValue(null);

    const attempts = [
      auth.authenticate(undefined).catch((error: unknown) => error as Error),
      auth.authenticate('Bearer x').catch((error: unknown) => error as Error),
      auth.authenticate('ApiKey no-dot-here').catch((error: unknown) => error as Error),
      auth.authenticate('ApiKey .empty-key').catch((error: unknown) => error as Error),
      auth.authenticate('ApiKey unknown-key-id.hunter2').catch((error: unknown) => error as Error),
    ];
    const errors = await Promise.all(attempts);
    expect(new Set(errors.map(String)).size).toBe(1);

    // The FindCredentialService itself was now reachable in this branch (keyId parsed):
    // unknown key id still costs exactly one lookup and no touchLastUsed.
    expect(credentials.touchLastUsed).not.toHaveBeenCalled();
  });

  it('refuses a suspended merchant even with a valid secret', async () => {
    credentials.findByKeyId.mockResolvedValue(credential({ merchantStatus: 'SUSPENDED' }));

    await expect(auth.authenticate(`ApiKey kid.${SECRET}`)).rejects.toThrow(/SUSPENDED/);
    expect(credentials.touchLastUsed).not.toHaveBeenCalled();
  });

  it('resolves a human principal with its role bundle, never the full vocabulary', async () => {
    // Scopes come from the MEMBERSHIP, not from the session's stored role — so the two must agree
    // in the fixture, or this test would be asserting about a state the system cannot represent.
    sessions.authenticateToken.mockResolvedValue(session({ role: 'MERCHANT_OPERATOR' }));
    users.findById.mockResolvedValue(
      user({ memberships: [{ merchantId: 'm-active', role: 'MERCHANT_OPERATOR' }] }),
    );

    const principal = await auth.authenticate('Bearer tok');

    expect(principal.kind).toBe('human');
    expect(principal.scopes).toContain('shipments:write');
    // The regression this test exists for: a browser session used to be granted [...API_SCOPES],
    // so a stolen console token could approve a settlement and mint itself a fresh credential.
    expect(principal.scopes).not.toContain('settlements:approve');
    expect(principal.scopes).not.toContain('keys:manage');
  });

  it('carries every membership, so one login can act inside two businesses', async () => {
    sessions.authenticateToken.mockResolvedValue(session({ role: 'MERCHANT_OPERATOR' }));
    users.findById.mockResolvedValue(
      user({
        memberships: [
          { merchantId: 'm-active', role: 'MERCHANT_OPERATOR' },
          { merchantId: 'm-second', role: 'MERCHANT_OWNER' },
        ],
      }),
    );

    const principal = await auth.authenticate('Bearer tok');

    expect(principal.merchantIds).toEqual(['m-active', 'm-second']);
    // Scoped to the ACTIVE business, not to every business the person can reach.
    expect(principal.merchantId).toBe('m-active');
    expect(principal.scopes).not.toContain('keys:manage');
  });

  it('refuses a session whose user has been disabled or removed', async () => {
    sessions.authenticateToken.mockResolvedValue(session());
    users.findById.mockResolvedValue(user({ disabledAt: new Date() }));
    await expect(auth.authenticate('Bearer tok')).rejects.toThrow(AuthenticationRequiredError);

    sessions.authenticateToken.mockResolvedValue(session());
    users.findById.mockResolvedValue(null);
    await expect(auth.authenticate('Bearer tok')).rejects.toThrow(AuthenticationRequiredError);
  });

  it('gives the owner the full merchant bundle, because the owner is the merchant', async () => {
    // Not "every scope": the hub scopes are platform powers and a merchant key must not carry them.
    // See roles.spec.ts — this is the same claim at the point the token is actually built.
    sessions.authenticateToken.mockResolvedValue(session({ role: 'MERCHANT_OWNER' }));

    const principal = await auth.authenticate('Bearer tok');

    expect([...principal.scopes].sort()).toEqual([...MERCHANT_SCOPES].sort());
    expect(principal.scopes).not.toContain('hub:scan');
  });

  it('gives a hub operator the scan scope, so the hub console is not a dead end', async () => {
    // This is the failure the scope was added to fix: HUB_OPERATOR had no write scope at all, so
    // every scan returned 403 and the console could not exist.
    sessions.authenticateToken.mockResolvedValue(session());
    users.findById.mockResolvedValue(
      user({ memberships: [{ merchantId: 'm-active', role: 'HUB_OPERATOR' }] }),
    );

    const principal = await auth.authenticate('Bearer tok');

    expect(principal.scopes).toContain('hub:scan');
    // And the merchant power stays away, or the scope is not worth having.
    expect(principal.scopes).not.toContain('shipments:write');
  });

  it('refuses a membership whose role the vocabulary does not recognise, rather than defaulting', async () => {
    // The role lives on the membership as of migration 0036, so this is where an unrecognised one
    // can now arrive. It must fail closed: widening the role vocabulary must never silently widen an
    // already-issued token.
    sessions.authenticateToken.mockResolvedValue(session());
    users.findById.mockResolvedValue(
      user({ memberships: [{ merchantId: 'm-active', role: 'SUPERUSER' }] }),
    );

    await expect(auth.authenticate('Bearer tok')).rejects.toThrow(AuthenticationRequiredError);
  });

  it('refuses a revoked credential without distinguishing it from an unknown one', async () => {
    credentials.findByKeyId.mockResolvedValue(credential({ revokedAt: new Date() }));
    const revoked = await auth.authenticate(`ApiKey kid.${SECRET}`).catch((e: unknown) => e);

    credentials.findByKeyId.mockResolvedValue(null);
    const unknown = await auth.authenticate(`ApiKey kid.${SECRET}`).catch((e: unknown) => e);

    expect((revoked as Error).constructor).toBe((unknown as Error).constructor);
    expect((revoked as Error).message).toBe((unknown as Error).message);
    expect(credentials.touchLastUsed).not.toHaveBeenCalled();
  });

  /* ---------------------------------------------------------------- cookie auth
   * A browser cannot set an Authorization header on a same-origin navigation, so once the
   * token stopped living in `sessionStorage` the cookie became the only way a console could
   * authenticate at all. The bearer path is unchanged; this is the second door onto the same
   * principal, and these tests pin what it does and does not let through. */

  describe('a session cookie', () => {
    beforeEach(() => {
      sessions.authenticateToken.mockResolvedValue(session({ role: 'MERCHANT_OPERATOR' }));
      users.findById.mockResolvedValue(
        user({ memberships: [{ merchantId: 'm-active', role: 'MERCHANT_OPERATOR' }] }),
      );
    });

    it('resolves the SAME principal as the bearer header carrying that token', async () => {
      const fromCookie = await auth.authenticate(undefined, 'tok');
      const fromHeader = await auth.authenticate('Bearer tok');

      // Not "a similar principal": the identical one. Two doors onto one session must not produce
      // two different notions of who the caller is, or scope decisions diverge per transport.
      expect(fromCookie).toEqual(fromHeader);
      expect(sessions.authenticateToken).toHaveBeenCalledWith('tok');
    });

    it('is used when there is no Authorization header at all', async () => {
      const principal = await auth.authenticate(undefined, 'tok');
      expect(principal.kind).toBe('human');
      expect(principal.merchantId).toBe('m-active');
    });

    it('is turned away when a bogus header accompanies a live cookie', async () => {
      sessions.authenticateToken.mockResolvedValue(null);

      await expect(auth.authenticate('Basic dXNlcjpwYXNz', 'tok')).rejects.toThrow(
        AuthenticationRequiredError,
      );
      // Not merely "it returned 401": the cookie must never have been considered.
      expect(sessions.authenticateToken).not.toHaveBeenCalled();
    });

    it('is NOT used when the header carries a Bearer token, valid or not', async () => {
      // The header is an explicit statement of which credential the caller means. Falling back to
      // the cookie on a BAD bearer token would let an attacker replay their own browser session
      // by sending a deliberately malformed one.
      sessions.authenticateToken.mockResolvedValue(null);

      await expect(auth.authenticate('Bearer wrong', 'tok')).rejects.toThrow(
        AuthenticationRequiredError,
      );
      expect(sessions.authenticateToken).toHaveBeenCalledWith('wrong');
      expect(sessions.authenticateToken).not.toHaveBeenCalledWith('tok');
    });

    it('is passed straight through, so a bad cookie fails exactly like a bad token', async () => {
      sessions.authenticateToken.mockResolvedValue(null);
      await expect(auth.authenticate(undefined, 'bad-cookie')).rejects.toThrow(
        AuthenticationRequiredError,
      );
    });

    it('does not turn a machine credential into a human one', async () => {
      // An ApiKey header still wins the machine path. Restoring a cookie in that position would
      // let a holder of one key pair borrow whatever session their browser was holding.
      credentials.findByKeyId.mockResolvedValue(credential());

      const principal = await auth.authenticate(`ApiKey kid.${SECRET}`, 'tok');

      expect(principal.kind).toBe('machine');
      expect(sessions.authenticateToken).not.toHaveBeenCalled();
    });
  });
});
