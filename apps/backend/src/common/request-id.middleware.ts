/**
 * Assigns every request a correlation id and makes it reachable from everywhere.
 *
 * Three things hang off it, and all three are needed for it to be worth having:
 *   - `request.requestId`, which the exception filter reads instead of the raw header
 *   - the `x-request-id` RESPONSE header, so a client reporting a failure can quote the id
 *   - the `httpRequestDuration` label, so a slow request can be found by the same id
 *
 * A response header the client cannot read is a support ticket that cannot be correlated. That is
 * the whole reason this exists.
 *
 * Registered in all three entrypoints? No — `main.ts` only. `worker.ts` and `publisher.ts` serve
 * `/metrics` over bare `http.createServer` and handle no user request; a request id on a Prometheus
 * scrape would be a metric label with unbounded cardinality, which docs/operations/observability.md
 * warns against. Their logs carry `trace_id` from the NATS message instead.
 */

import type { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id.ts';

export interface RequestWithId extends Request {
  requestId?: string;
}

export function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const inbound = req.headers[REQUEST_ID_HEADER];
  req.requestId = resolveRequestId(inbound);
  res.setHeader('x-request-id', req.requestId);
  next();
}
