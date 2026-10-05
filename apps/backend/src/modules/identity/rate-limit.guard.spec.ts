import { describe, expect, it } from 'vitest';
import { RateLimitGuard } from './rate-limit.guard.ts';
import { RateLimitedError } from '../../common/domain-error.ts';

function context(principal: unknown, ip = '1.2.3.4') {
  const headers: Record<string, string> = {};
  return {
    switchToHttp: () => ({
      getRequest: () => ({ principal, ip }),
      getResponse: () => ({ setHeader: (k: string, v: string) => void (headers[k] = v) }),
    }),
    headers,
  } as never;
}

function fakeRedis(count: number, ttlMs = 42_000) {
  return {
    pipeline: () => {
      const calls: string[] = [];
      return {
        zadd: (...args: unknown[]) => void calls.push(`zadd:${String(args[0])}`),
        zremrangebyscore: () => undefined,
        zcard: () => undefined,
        expire: () => undefined,
        pttl: () => undefined,
        exec: async () => [
          [null, 1],
          [null, 1],
          [null, count],
          [null, 1],
          [null, ttlMs],
        ],
      };
    },
  } as never;
}

describe('RateLimitGuard', () => {
  it('sets RateLimit-* headers and allows under the limit', async () => {
    const ctx = context({ credentialId: 'cred-1' });
    const guard = new RateLimitGuard('merchant', true, fakeRedis(10));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((ctx as { headers: Record<string, string> }).headers['RateLimit-Limit']).toBe('600');
    expect((ctx as { headers: Record<string, string> }).headers['RateLimit-Remaining']).toBe('590');
  });

  it('rejects with 429 + Retry-After over the limit', async () => {
    const ctx = context({ credentialId: 'cred-1' });
    const guard = new RateLimitGuard('merchant', true, fakeRedis(601));
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(RateLimitedError);
    expect((ctx as { headers: Record<string, string> }).headers['Retry-After']).toBeDefined();
  });

  it('fails closed on mutations when Redis is down, open on reads', async () => {
    const down = {
      pipeline: () => {
        throw new Error('ECONNREFUSED');
      },
    } as never;
    await expect(
      new RateLimitGuard('merchant', true, down).canActivate(context(null)),
    ).rejects.toBeInstanceOf(RateLimitedError);
    await expect(
      new RateLimitGuard('public', false, down).canActivate(context(null)),
    ).resolves.toBe(true);
  });
});
