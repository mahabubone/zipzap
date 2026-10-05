import { describe, expect, it } from 'vitest';
import { rateLimitHeaders, rateLimitKey } from './rate-limit.ts';

describe('rate-limit policy', () => {
  it('keys merchants by credential, anonymous callers by IP', () => {
    expect(rateLimitKey('merchant', 'cred-1', '1.2.3.4').key).toBe('ratelimit:merchant:cred-1');
    expect(rateLimitKey('public', null, '1.2.3.4').key).toBe('ratelimit:public:ip:1.2.3.4');
  });

  it('matches the documented tiers', () => {
    expect(rateLimitKey('merchant', 'c', 'ip')).toMatchObject({ limit: 600, windowSeconds: 60 });
    expect(rateLimitKey('public', null, 'ip')).toMatchObject({ limit: 100, windowSeconds: 60 });
    expect(rateLimitKey('webhook', 'c', 'ip')).toMatchObject({ limit: 30, windowSeconds: 60 });
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
