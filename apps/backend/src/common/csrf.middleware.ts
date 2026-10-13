/**
 * CSRF protection for the cookie session.
 *
 * `SameSite=Lax` already stops a cross-site POST from carrying the cookie, so this is not the
 * primary defence — it is the one that does not depend on every browser implementing `SameSite`
 * correctly, and the one that keeps working if someone later loosens the attribute to make a
 * redirect work.
 *
 * A browser cannot set `Origin` or `Sec-Fetch-Site` from script, so both are unforgeable in the
 * case this cares about. A native client sends neither header and uses `Authorization`, which is
 * unaffected — so it never rejects a machine principal.
 *
 * No token to mint, no double-submit: a CSRF token has to be injected into the page and echoed
 * back, which puts the session in the DOM again and gives back most of what `HttpOnly` bought.
 *
 * Registered as a Nest middleware rather than `app.use()` in `main.ts`, because a middleware
 * error thrown from an `app.use` callback lands in Express's own error handler and renders as a
 * 500 HTML page. This throws an `AuthenticationRequiredError`, which `DomainExceptionFilter`
 * turns into the same §87 envelope every other auth failure produces — a client must not have to
 * handle a second error shape for one class of rejection.
 */

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { AuthenticationRequiredError } from './domain-error.ts';

/** Requests that cannot change state, and therefore cannot be a CSRF target. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

/**
 * Where the request claims to come from. An explicit `Origin` is authoritative; `Sec-Fetch-Site`
 * is the more honest of the two when both are present. No header at all means a non-browser
 * client, which authenticates with `Authorization` and is never a CSRF target.
 */
function crossSite(request: Request): boolean {
  const { origin } = request.headers;
  if (typeof origin === 'string' && origin.length > 0) {
    return !isSameOrigin(request, origin);
  }
  const fetchSite = request.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string') return fetchSite !== 'same-origin' && fetchSite !== 'none';
  return false;
}

function isSameOrigin(request: Request, origin: string): boolean {
  const host = request.headers['x-forwarded-host'] ?? request.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === String(host);
  } catch {
    return false;
  }
}

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    if (!SAFE_METHODS.has(request.method) && crossSite(request)) {
      throw new AuthenticationRequiredError();
    }
    next();
  }
}
