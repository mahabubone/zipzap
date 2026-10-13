import { describe, expect, it, vi } from 'vitest';
import { requestIdMiddleware, type RequestWithId } from './request-id.middleware.ts';

/**
 * The middleware's whole job is putting one validated id in three places. If any of the three is
 * missing the feature is decorative.
 */

function fakeReq(inbound?: unknown): RequestWithId {
  return { headers: inbound === undefined ? {} : { 'x-request-id': inbound } } as RequestWithId;
}

function fakeRes() {
  const headers: Record<string, string> = {};
  return { headers, setHeader: (k: string, v: string) => (headers[k] = v) } as never;
}

describe('requestIdMiddleware', () => {
  it('assigns an id, echoes it to the client, and continues', () => {
    const req = fakeReq();
    const res = fakeRes();
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
    const response = res as unknown as { headers: Record<string, string> };
    expect(response.headers['x-request-id']).toBe(req.requestId);
    expect(next).toHaveBeenCalledOnce();
  });

  it('preserves a valid inbound id across the request boundary', () => {
    const req = fakeReq('client-trace-1');
    requestIdMiddleware(req, fakeRes(), vi.fn());
    expect(req.requestId).toBe('client-trace-1');
  });

  it('replaces a forged inbound id rather than forwarding it to the client', () => {
    const req = fakeReq('bad\nX-Injected: 1');
    const res = fakeRes();

    requestIdMiddleware(req, res, vi.fn());

    const response = res as unknown as { headers: Record<string, string> };
    expect(response.headers['x-request-id']).not.toContain('\n');
    expect(req.requestId).toBe(response.headers['x-request-id']);
  });
});
