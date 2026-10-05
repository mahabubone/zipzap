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

/** What the guard knows about the caller. Public traffic has none (anonymous). */
export interface RateLimitCaller {
  readonly credentialId: string;
  readonly merchantId: string | null;
  /** Per-contract override, req/min. Applies to the merchant tier only. */
  readonly rateLimitPerMin?: number | null;
}

export interface RateLimitKey {
  /** Redis key suffix. */
  readonly key: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

/**
 * The counter subject: merchant tiers count PER MERCHANT, public counts per IP.
 *
 * Keying a merchant tier by credential would give a merchant N× its contract
 * limit for N keys — the limit is a property of the contract, not of how many
 * keys were issued. The contract override (merchants.rate_limit_per_min) only
 * means something if the counter is merchant-scoped.
 *
 * The override is clamped: a contract typo must not create a 0-limit deadlock
 * or a million-req/min hole. The DB CHECK rejects ≤0; this clamps the ceiling.
 */
const MAX_OVERRIDE_PER_MIN = 100_000;

export function rateLimitKey(
  tier: RateLimitTier,
  caller: RateLimitCaller | null,
  ip: string,
): RateLimitKey {
  const policy = RATE_LIMIT_TIERS[tier];
  const subject =
    tier === 'public' || !caller ? `ip:${ip}` : (caller.merchantId ?? caller.credentialId);
  let limit: number = policy.limit;
  if (tier === 'merchant' && caller?.rateLimitPerMin != null) {
    limit = Math.max(1, Math.min(caller.rateLimitPerMin, MAX_OVERRIDE_PER_MIN));
  }
  return {
    key: `ratelimit:${tier}:${subject}`,
    limit,
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
