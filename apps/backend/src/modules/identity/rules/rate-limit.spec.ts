import { describe, expect, it } from 'vitest';
import { rateLimitHeaders, rateLimitKey, type RateLimitCaller } from './rate-limit.ts';

const caller = (merchantId: string, rateLimitPerMin?: number | null): RateLimitCaller => ({
  credentialId: `cred-${merchantId}`,
  merchantId,
  rateLimitPerMin,
});

describe('rate-limit policy', () => {
  it('keys merchant tiers by MERCHANT, public by IP', () => {
    // Two credentials of one merchant share one counter: the limit belongs to
    // the contract, not to how many keys were issued.
    expect(rateLimitKey('merchant', caller('m-1'), '1.2.3.4').key).toBe('ratelimit:merchant:m-1');
    expect(
      rateLimitKey('merchant', { credentialId: 'cred-2', merchantId: 'm-1' }, '9.9.9.9').key,
    ).toBe('ratelimit:merchant:m-1');
    expect(rateLimitKey('public', null, '1.2.3.4').key).toBe('ratelimit:public:ip:1.2.3.4');
    expect(rateLimitKey('webhook', caller('m-1'), '1.2.3.4').key).toBe('ratelimit:webhook:m-1');
  });

  it('matches the documented tier defaults', () => {
    expect(rateLimitKey('merchant', caller('m-1'), 'ip')).toMatchObject({
      limit: 600,
      windowSeconds: 60,
    });
    expect(rateLimitKey('public', null, 'ip')).toMatchObject({ limit: 100, windowSeconds: 60 });
    expect(rateLimitKey('webhook', caller('m-1'), 'ip')).toMatchObject({
      limit: 30,
      windowSeconds: 60,
    });
  });

  it('honours the per-contract override, clamped at both ends', () => {
    expect(rateLimitKey('merchant', caller('m-1', 50), 'ip').limit).toBe(50);
    // DB CHECK rejects ≤0; the ceiling stops a typo becoming an unlimited hole.
    expect(rateLimitKey('merchant', caller('m-1', 0), 'ip').limit).toBe(1);
    expect(rateLimitKey('merchant', caller('m-1', 9_999_999), 'ip').limit).toBe(100_000);
    // The override is merchant-tier only: public tracking stays per-IP at its tier.
    expect(rateLimitKey('public', caller('m-1', 50), 'ip').limit).toBe(100);
  });

  it('emits draft RateLimit-* headers, never X- prefixed', () => {
    expect(rateLimitHeaders(100, 58, 42)).toEqual({
      'RateLimit-Limit': '100',
      'RateLimit-Remaining': '42',
      'RateLimit-Reset': '42',
    });
    expect(rateLimitHeaders(100, 150, 0)).toMatchObject({ 'RateLimit-Remaining': '0' });
  });
});
