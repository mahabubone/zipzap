/**
 * Rate-limit policy. Framework-free: no @nestjs, no ioredis.
 *
 * Two pure decisions: which tier a route belongs to (declared at the decorator
 * site, next to the scope — the route author knows whether it mutates), and
 * what the headers say. The Redis sliding window itself lives in the guard;
 * everything computable without I/O lives here, where it is unit-testable.
 *
 * Fail mode comes from docs/api/rate-limits.md: closed on mutations, open on
 * reads. A Redis outage must reject a shipment create (protect the database)
 * but must not take down tracking reads (cheap, not a DoS vector).
 */

export const RATE_LIMIT_TIERS = {
  /** Authenticated merchant traffic. Generous: the per-contract tuning in the doc has no table yet. */
  merchant: { limit: 600, windowSeconds: 60 },
  /** Public tracking: 100 req/min per IP, per the doc. */
  public: { limit: 100, windowSeconds: 60 },
  /** Webhook endpoint management: 30 req/min per merchant, per the doc. */
  webhook: { limit: 30, windowSeconds: 60 },
} as const;

export type RateLimitTier = keyof typeof RATE_LIMIT_TIERS;

export interface RateLimitKey {
  /** Redis key suffix. Per credential for merchants, per IP for public. */
  readonly key: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

/** Credential-bound callers share nothing across merchants; anonymous callers share per IP. */
export function rateLimitKey(
  tier: RateLimitTier,
  credentialId: string | null,
  ip: string,
): RateLimitKey {
  const policy = RATE_LIMIT_TIERS[tier];
  const subject = credentialId ?? `ip:${ip}`;
  return {
    key: `ratelimit:${tier}:${subject}`,
    limit: policy.limit,
    windowSeconds: policy.windowSeconds,
  };
}

export interface RateLimitHeaders {
  readonly 'RateLimit-Limit': string;
  readonly 'RateLimit-Remaining': string;
  readonly 'RateLimit-Reset': string;
}

/** Draft `RateLimit-*`, not `X-RateLimit-*` — per docs/api/rate-limits.md. */
export function rateLimitHeaders(
  limit: number,
  count: number,
  resetAfterSeconds: number,
): RateLimitHeaders {
  return {
    'RateLimit-Limit': String(limit),
    'RateLimit-Remaining': String(Math.max(0, limit - count)),
    'RateLimit-Reset': String(Math.max(0, Math.ceil(resetAfterSeconds))),
  };
}
