/**
 * Shared Redis client for rate limiting. A module singleton, not DI.
 *
 * RateLimitGuard is instantiated at the decorator site (`new RateLimitGuard(...)`),
 * like ScopeGuard — Nest never constructs it, so @Inject would always resolve
 * undefined. The guard takes an optional client for tests and falls back to this
 * shared one in production. Created lazily on first request, never at import:
 * decorator expressions evaluate at import time, and opening a connection then
 * would connect Redis from every unit test that imports a controller.
 *
 * Fail-fast settings: `enableOfflineQueue: false` so a dead Redis rejects the
 * command immediately instead of queueing it forever — the guard's fail mode
 * (closed on writes, open on reads) only works if the failure surfaces.
 */

import { Redis } from 'ioredis';
import { config } from '../../config.ts';

let shared: Redis | undefined;

export function sharedRateLimitRedis(): Redis {
  if (!shared) {
    shared = new Redis(config().redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
    });
    shared.on('error', () => {
      // Swallowed: the guard treats a failed command as "Redis down" and
      // applies its fail mode. An unhandled error event would crash the process.
    });
  }
  return shared;
}
