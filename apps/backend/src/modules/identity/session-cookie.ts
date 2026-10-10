/**
 * The session cookie — the transport a browser uses to carry a session.
 *
 * A bearer token in `sessionStorage` is readable by any script on the page, which means an XSS
 * gets a usable credential and can replay it from anywhere. An `HttpOnly` cookie is not readable
 * by script: the browser holds it and attaches it, so an XSS gets a room and no key. That is the
 * whole point, and it is why the token is deliberately NOT also returned in a response body when
 * the cookie is set — otherwise the header sets a lock and the body hands out the key.
 *
 * Hand-rolled rather than `cookie-parser`, because the whole surface is one cookie and a
 * `Set-Cookie` header. Parsing is ~4 lines and adding a dependency for it is a bigger footprint
 * than the code.
 */

import type { Request, Response } from 'express';

export const SESSION_COOKIE_NAME = 'zipzap_session';

/**
 * Absolute lifetime of a session, and the idle window within it.
 *
 * Idle expiry is what protects a machine someone walks away from; absolute expiry is what
 * guarantees a stolen session does eventually stop working even if the thief keeps it warm.
 * Sliding renewal extends `expires_at` on use but never past `LEAST(now + idle, created_at +
 * absolute)`, so the ceiling is real.
 */
export const SESSION_IDLE_TTL_HOURS = 12;
export const SESSION_ABSOLUTE_TTL_HOURS = 168;

/** The cookie attributes. `Secure` is what makes `HttpOnly` mean anything on the wire. */
function buildCookie(value: string, maxAgeSeconds: number): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'Secure',
    // `Lax` rather than `Strict`: the console sends the cookie on top-level GET navigations from
    // an email or a redirect, which `Strict` would block and which would look like a broken login.
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ];
  return attributes.join('; ');
}

/**
 * Reads the session token off a request.
 *
 * An empty or absent header returns null rather than an empty string, so callers cannot mistake
 * "no cookie" for "a cookie with no value" and go looking for a session by empty hash.
 */
export function readSessionCookie(request: Request): string | null {
  const header = request.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE_NAME) {
      const value = part.slice(separator + 1).trim();
      return value === '' ? null : decodeURIComponent(value);
    }
  }
  return null;
}

export function setSessionCookie(response: Response, token: string, expiresAt: Date): void {
  const maxAgeSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  response.setHeader('Set-Cookie', buildCookie(token, maxAgeSeconds));
}

export function clearSessionCookie(response: Response): void {
  // `Max-Age=0` is the only way a browser drops one: the client cannot, because it cannot read it.
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
  );
}
