import { describe, expect, it, vi } from 'vitest';
import { SecretInAuditMetadataError, assertNoSecrets, record } from './audit.writer.ts';

/**
 * The denylist IS the rule. "Never log a password" written in a comment is a wish; this is the
 * check that makes it true.
 */

function fakeManager() {
  const query = vi.fn().mockResolvedValue([]);
  return { query, manager: { query } as never };
}

describe('assertNoSecrets', () => {
  it.each([
    ['password', { password: 'hunter2' }],
    ['nested password', { user: { password: 'hunter2' } }],
    ['api_key', { api_key: 'sk_live_x' }],
    ['apiKey camelCase', { apiKey: 'sk_live_x' }],
    ['authorization header', { authorization: 'Bearer abc' }],
    ['cookie', { cookie: 'sid=1' }],
    ['signing secret', { signingSecret: 'whsec_x' }],
    ['secretHash', { secretHash: 'scrypt$1$2$3' }],
    ['inside an array', { attempts: [{ password: 'x' }] }],
    ['deeply nested', { a: { b: { c: { token: 'x' } } } }],
  ])('rejects %s', (_label, metadata) => {
    expect(() => assertNoSecrets(metadata)).toThrow(SecretInAuditMetadataError);
  });

  it.each([
    ['ids', { shipmentId: 's-1' }],
    ['counts', { attempts: 3, codMinor: 125050 }],
    ['states', { from: 'CREATED', to: 'HELD' }],
    ['empty metadata', {}],
    ['a field merely containing the word', { reason: 'password reset requested' }],
  ])('allows %s', (_label, metadata) => {
    expect(() => assertNoSecrets(metadata)).not.toThrow();
  });

  it('names the path so the caller knows which key to fix', () => {
    expect(() => assertNoSecrets({ user: { password: 'x' } })).toThrow(
      /metadata\.root\.user\.password/,
    );
  });
});

describe('record', () => {
  const ENTRY = {
    actorType: 'human',
    action: 'auth.login.succeeded',
    merchantId: 'm-1',
    actorId: 'u-9',
    requestId: 'req-1',
  } as const;

  it('writes the row with every provenance field', async () => {
    const { query, manager } = fakeManager();

    await record(manager, { ...ENTRY, ip: '203.0.113.4', userAgent: 'curl/8', targetId: 's-1' });

    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO system.audit_events');
    expect(params).toContain('auth.login.succeeded');
    expect(params).toContain('203.0.113.4');
    // An audit row outlives log retention: assert nothing denylisted ever reaches the column.
    expect(JSON.stringify(params)).not.toMatch(/password|secret|token/i);
  });

  it('refuses to write rather than silently redacting a secret', async () => {
    const { query, manager } = fakeManager();

    await expect(record(manager, { ...ENTRY, metadata: { password: 'hunter2' } })).rejects.toThrow(
      SecretInAuditMetadataError,
    );

    // Nothing written: a redacted row would hide the caller's bug.
    expect(query).not.toHaveBeenCalled();
  });

  it('defaults metadata to an empty object, never null', async () => {
    const { query, manager } = fakeManager();

    await record(manager, { ...ENTRY });

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params.at(-1)).toBe('{}');
  });

  it('records a failed login with no actor, because nobody authenticated', async () => {
    const { query, manager } = fakeManager();

    await record(manager, { actorType: 'human', action: 'auth.login.failed', ip: '198.51.100.7' });

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toContain(null); // actor_id
    expect(params).toContain('auth.login.failed');
  });
});
