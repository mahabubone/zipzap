/**
 * Request identity. Framework-free, because the interesting part is deciding what to trust.
 *
 * A `request_id` is worthless unless it is on every log line and in every error body. The filter
 * used to fall back to the literal string `'unknown'`, which means one incident produced N log
 * lines with N different `'unknown'` keys and no way to correlate them.
 *
 * The inbound header is attacker-controlled, so it is NOT trusted:
 *
 *   - **validated**, not sanitised-by-concatenation. Only `[A-Za-z0-9_-]` up to 64 chars passes;
 *     anything else is replaced. A newline in this value would forge a log line, and a terminal
 *     escape sequence in a log viewer is worse.
 *   - **never used for anything but correlation.** Not a metric label (docs/operations/
 *     observability.md: unbounded label values fall Prometheus over), not an idempotency key, not
 *     a filename. It is a join key and nothing else.
 *
 * `ponytail:` no W3C `traceparent` support and no span creation here. OTel is wired in
 * docs/architecture/overview.md but the correlation we actually need is one id, and adding a
 * tracer before anything emits spans would produce a beautiful trace of nothing. Add propagation
 * when the first real span exists.
 */

import { randomUUID } from 'node:crypto';

/** Anything outside this is replaced rather than cleaned: a rewritten id beats a forged one. */
const SAFE = /^[A-Za-z0-9_-]{1,64}$/;

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * The id for a request. Keeps a valid inbound id so a client, a proxy and the log agree; mints one
 * otherwise.
 */
export function resolveRequestId(inbound: unknown): string {
  if (typeof inbound === 'string' && SAFE.test(inbound)) return inbound;
  // `randomUUID` is 36 chars of [0-9a-f-], already inside SAFE.
  return randomUUID();
}

/** Whether an inbound value was honoured, for the log line that says so. */
export function isTrustedRequestId(value: unknown): boolean {
  return typeof value === 'string' && SAFE.test(value);
}
