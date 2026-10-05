/**
 * RateLimitGuard: Redis sliding-window, per tier.
 *
 * Instantiated at the decorator site like ScopeGuard — `new RateLimitGuard('merchant', true)`
 * — because the tier and the fail mode are route properties, not global config. Nest never
 * constructs it, so there is no DI: the Redis client is the shared singleton in
 * rate-limit.redis.ts, overridable per instance for tests.
 *
 * The client resolves LAZILY on first request, never in the constructor: decorator
 * expressions evaluate at import time, and unit tests import controllers without
 * any environment — touching config() or Redis there would break every suite.
 *
 * Fail mode is the load-bearing decision (docs/api/rate-limits.md): CLOSED on
 * mutations, OPEN on reads. A Redis outage rejecting shipment creation protects
 * the database; a Redis outage taking down tracking reads trades a rate-limit
 * policy for availability, which is the wrong trade.
 *
 * Headers go on every response, allowed or denied: a client that cannot see its
 * remaining budget cannot back off. 429 carries `Retry-After` — the only thing
 * a generic HTTP client reads — plus the `RATE_LIMITED` envelope from the filter.
 */

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { RateLimitedError } from '../../common/domain-error.ts';
import type { AuthenticatedRequest } from './api-key.guard.ts';
import { sharedRateLimitRedis } from './rate-limit.redis.ts';
import { rateLimitHeaders, rateLimitKey, type RateLimitTier } from './rules/rate-limit.ts';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly tier: RateLimitTier,
    /** true = reject on Redis failure (mutations); false = allow (reads). */
    private readonly failClosed: boolean,
    private readonly explicit?: Redis,
  ) {}

  private resolveRedis(): Redis | undefined {
    if (this.explicit) return this.explicit;
    try {
      return sharedRateLimitRedis();
    } catch {
      // No environment (unit tests) or no URL: same as Redis down.
      return undefined;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const principal = request.principal;

    const { key, limit, windowSeconds } = rateLimitKey(
      this.tier,
      principal?.credentialId ?? null,
      request.ip ?? 'unknown',
    );

    const redis = this.resolveRedis();
    if (!redis) {
      // No client at all: the fail mode still applies.
      if (this.failClosed) throw new RateLimitedError(windowSeconds);
      return true;
    }

    let count: number;
    let ttlSeconds: number;
    try {
      const nowMs = Date.now();
      const member = `${nowMs}:${Math.random().toString(36).slice(2)}`;
      const pipeline = redis.pipeline();
      pipeline.zadd(key, nowMs.toString(), member);
      pipeline.zremrangebyscore(key, 0, (nowMs - windowSeconds * 1000).toString());
      pipeline.zcard(key);
      pipeline.expire(key, windowSeconds);
      pipeline.pttl(key);
      const results = await pipeline.exec();
      count = Number(results?.[2]?.[1] ?? 0);
      ttlSeconds = Number(results?.[4]?.[1] ?? windowSeconds * 1000) / 1000;
    } catch {
      // Redis down: the fail mode IS the policy. Closed on writes, open on reads.
      if (this.failClosed) throw new RateLimitedError(windowSeconds);
      return true;
    }

    const headers = rateLimitHeaders(limit, count, ttlSeconds);
    response.setHeader('RateLimit-Limit', headers['RateLimit-Limit']);
    response.setHeader('RateLimit-Remaining', headers['RateLimit-Remaining']);
    response.setHeader('RateLimit-Reset', headers['RateLimit-Reset']);

    if (count > limit) {
      response.setHeader('Retry-After', String(Math.ceil(ttlSeconds)));
      throw new RateLimitedError(Math.ceil(ttlSeconds));
    }
    return true;
  }
}
