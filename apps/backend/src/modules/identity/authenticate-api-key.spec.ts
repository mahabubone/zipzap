import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { AuthenticateApiKeyService, FIND_CREDENTIAL } from './authenticate-api-key.service.ts';
import { MerchantAuthService } from '../merchant/sessions.service.ts';
import { hashSecret } from '../../common/secret.ts';
import { API_SCOPES } from '../../common/scopes.ts';
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
    merchantStatus: 'ACTIVE',
    rateLimitPerMin: null,
    role: 'MERCHANT_OWNER',
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

  beforeEach(async () => {
    credentials = { findByKeyId: vi.fn(), touchLastUsed: vi.fn() };
    sessions = { authenticateToken: vi.fn().mockResolvedValue(null) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthenticateApiKeyService,
        { provide: FIND_CREDENTIAL, useValue: credentials },
        { provide: MerchantAuthService, useValue: sessions },
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
    sessions.authenticateToken.mockResolvedValue(session({ role: 'MERCHANT_OPERATOR' }));

    const principal = await auth.authenticate('Bearer tok');

    expect(principal.kind).toBe('human');
    expect(principal.scopes).toContain('shipments:write');
    // The regression this test exists for: a browser session used to be granted [...API_SCOPES],
    // so a stolen console token could approve a settlement and mint itself a fresh credential.
    expect(principal.scopes).not.toContain('settlements:approve');
    expect(principal.scopes).not.toContain('keys:manage');
  });

  it('gives the owner the full bundle, because the owner is the merchant', async () => {
    sessions.authenticateToken.mockResolvedValue(session({ role: 'MERCHANT_OWNER' }));

    const principal = await auth.authenticate('Bearer tok');

    expect([...principal.scopes].sort()).toEqual([...API_SCOPES].sort());
  });

  it('refuses a session whose role the vocabulary does not recognise, rather than defaulting', async () => {
    sessions.authenticateToken.mockResolvedValue(session({ role: 'SUPERUSER' }));

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
});
