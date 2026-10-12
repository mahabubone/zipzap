/**
 * The session cookie, and the CSRF guard that goes with it.
 *
 * These are the tests for the change that removes the `sessionStorage` bearer token. That design
 * was not merely inelegant: any script on the page could read the token and replay it from
 * anywhere, so an XSS did not get a session it had to use carefully — it got a credential.
 *
 * What matters most is what they do NOT let through. A cookie that a cross-site POST can carry is
 * a CSRF vulnerability wearing a security costume, so both halves matter: the browser holds the
 * cookie so script cannot read it, and the middleware refuses a state change that arrived from
 * somewhere else.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { CsrfMiddleware } from './csrf.middleware.ts';
import {
  clearSessionCookie,
  readSessionCookie,
  SESSION_ABSOLUTE_TTL_HOURS,
  SESSION_COOKIE_NAME,
  SESSION_IDLE_TTL_HOURS,
  setSessionCookie,
} from '../modules/identity/session-cookie.ts';

/** A request with only the fields the middleware reads, so the assertions stay honest. */
function requestWith(headers: Record<string, string> = {}, method = 'POST'): Request {
  return { method, headers } as unknown as Request;
}

describe('CsrfMiddleware', () => {
  const next = vi.fn<(error?: unknown) => void>();

  beforeEach(() => {
    next.mockClear();
  });

  it('passes a same-origin POST on', () => {
    const middleware = new CsrfMiddleware();
    const request = requestWith(
      { origin: 'https://console.zipzap.example', host: 'console.zipzap.example' },
      'POST',
    );
    middleware.use(request, {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('rejects a cross-origin POST', () => {
    const middleware = new CsrfMiddleware();
    const request = requestWith(
      { origin: 'https://evil.example', host: 'console.zipzap.example' },
      'POST',
    );
    expect(() => middleware.use(request, {} as Response, next as NextFunction)).toThrow(
      /authentication/i,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a POST whose Sec-Fetch-Site says cross-site, with no Origin header to trust', () => {
    const middleware = new CsrfMiddleware();
    const request = requestWith({ 'sec-fetch-site': 'cross-site', host: 'console.zipzap.example' });
    expect(() => middleware.use(request, {} as Response, next as NextFunction)).toThrow(
      /authentication/i,
    );
  });

  it('does not touch a GET, whatever its origin', () => {
    const middleware = new CsrfMiddleware();
    const request = requestWith(
      { origin: 'https://elsewhere.example', host: 'console.zipzap.example' },
      'GET',
    );
    middleware.use(request, {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('passes a request with no Origin or Sec-Fetch-Site at all — a native client, not a browser', () => {
    // The rider app sends neither and authenticates with Authorization. Rejecting it here would
    // break the whole mobile client for a CSRF vector it is not exposed to.
    const middleware = new CsrfMiddleware();
    middleware.use(requestWith({}, 'POST'), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('rejects a malformed Origin rather than treating it as absent', () => {
    // "not a url" is not "no url". A parser that returns null and a caller that reads null as
    // "nothing declared" is the shape of a bypass.
    const middleware = new CsrfMiddleware();
    const request = requestWith({ origin: 'not-a-url', host: 'console.zipzap.example' });
    expect(() => middleware.use(request, {} as Response, next as NextFunction)).toThrow(
      /authentication/i,
    );
  });
});

describe('the session cookie', () => {
  function mockResponse(): Response {
    return {
      setHeader: vi.fn(),
    } as unknown as Response;
  }

  it('is HttpOnly, Secure and SameSite=Lax, with a Max-Age the browser will honour', () => {
    const response = mockResponse();
    setSessionCookie(response, 'tok', new Date(Date.now() + 3600 * 1000));

    const [name, value] = vi.mocked(response.setHeader).mock.calls[0] ?? [];
    expect(name).toBe('Set-Cookie');
    expect(value).toContain(`${SESSION_COOKIE_NAME}=tok`);
    expect(value).toContain('HttpOnly');
    expect(value).toContain('Secure');
    expect(value).toContain('SameSite=Lax');
    // The Max-Age is a FLOOR of the remaining lifetime, so an expiry of exactly "now + one hour"
    // legitimately renders as 3599 whenever the millisecond tick lands between building the Date
    // and reading `Date.now()` inside the helper. Asserting `3600` here tested the clock, not the
    // cookie — it failed roughly once per thousand runs, passed in isolation, and only surfaced
    // under the parallel load of a full turbo run.
    //
    // What the browser actually needs is a positive integer close to an hour, so that is what is
    // asserted: the property, not a value that races the test runner.
    const maxAge = Number(/Max-Age=(\d+)/.exec(String(value))?.[1]);
    expect(Number.isInteger(maxAge)).toBe(true);
    expect(maxAge).toBeGreaterThan(3595);
    expect(maxAge).toBeLessThanOrEqual(3600);
    // `Path=/` matters more than it looks: without it the cookie is scoped to the directory it
    // was set from, and a later navigation to a sibling route arrives unauthenticated.
    expect(value).toContain('Path=/');
  });

  it('never lets a Max-Age go to zero for a live session', () => {
    const response = mockResponse();
    // Already expired: a browser drops the cookie outright on Max-Age<=0, which is the correct
    // outcome, but the header still has to be a cookie rather than an empty one.
    setSessionCookie(response, 'tok', new Date(Date.now() - 1));
    const value = vi.mocked(response.setHeader).mock.calls[0]?.[1];
    expect(String(value)).toContain('Max-Age=1');
  });

  it('is cleared with Max-Age=0, because the client cannot clear a cookie it cannot read', () => {
    const response = mockResponse();
    clearSessionCookie(response);
    const value = vi.mocked(response.setHeader).mock.calls[0]?.[1];
    expect(String(value)).toContain('Max-Age=0');
    expect(String(value)).toContain('HttpOnly');
  });

  describe('reading it back off a request', () => {
    it('parses the cookie among others', () => {
      const request = { headers: { cookie: `a=1; ${SESSION_COOKIE_NAME}=tok; b=2` } } as Request;
      expect(readSessionCookie(request)).toBe('tok');
    });

    it('returns null rather than an empty string for a cookie with no value', () => {
      // Empty would make callers look for a session hashed from "" — a row nobody can find, so
      // the failure looks like a corrupted store instead of "no cookie was sent".
      const request = { headers: { cookie: SESSION_COOKIE_NAME } } as Request;
      expect(readSessionCookie(request)).toBeNull();
    });

    it('returns null when there is no cookie header at all', () => {
      expect(readSessionCookie({ headers: {} } as Request)).toBeNull();
    });

    it('decodes a value that was percent-encoded on the way out', () => {
      const request = { headers: { cookie: `${SESSION_COOKIE_NAME}=a%2Bb` } } as Request;
      expect(readSessionCookie(request)).toBe('a+b');
    });
  });

  it('has an absolute expiry well beyond the idle window, so a sliding session still ends', () => {
    // Sliding renewal bounds `expires_at` at created_at + absolute. If the two were equal, the
    // slide would be a no-op; if absolute were unbounded, a stolen session never died on its own.
    expect(SESSION_ABSOLUTE_TTL_HOURS).toBeGreaterThan(SESSION_IDLE_TTL_HOURS * 4);
    expect(SESSION_ABSOLUTE_TTL_HOURS).toBeLessThanOrEqual(720);
  });
});
