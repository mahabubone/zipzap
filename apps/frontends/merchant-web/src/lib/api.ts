import { ZipZapClient, type ClientOptions } from '@zipzap/api-client';

/**
 * The API lives at `/api` on THIS origin, not on `:3000`.
 *
 * It used to be `http://localhost:3000`, with the token in `sessionStorage` and attached by hand.
 * That made the browser talk to a different origin, which meant CORS, which meant the token could
 * never safely live in a cookie — a cross-origin XHR cannot send one without `SameSite=None`, and
 * `SameSite=None` is both a third-party cookie (deprecated, and blocked by a growing number of
 * browsers) and no CSRF protection at all.
 *
 * Same-origin removes the problem: the console's own server forwards `/api` to the backend, the
 * browser sends `Cookie: zipzap_session` on an ordinary request with no script involvement, and
 * there is no CORS surface left to configure.
 *
 * `credentials: 'same-origin'` is the default for fetch but stated anyway, because an accidental
 * `omit` somewhere silently drops the cookie and produces a login that "works" until it doesn't.
 *
 * The client is no longer bound to a stored session, so there is nothing to re-read per render.
 * It is a module singleton: the session lives in a cookie the browser attaches itself, and creating
 * a per-render instance to "keep it fresh" was always working around state that should never have
 * been in JavaScript.
 */
const options = {
  baseUrl: '/api',
  // `as const` so this is the literal `'same-origin'`, not a widened `string` that the client's
  // CredentialsMode union rejects.
  credentials: 'same-origin',
} as const;

export function apiClient(overrides?: Partial<ClientOptions>): ZipZapClient {
  return new ZipZapClient({ ...options, ...overrides });
}

/**
 * The client for `login`, before any session exists.
 *
 * `credentials` is `'same-origin'`, NOT `'omit'`. `omit` tells the browser not to send cookies AND
 * not to store any the response sets — so `POST /v1/auth/login` returns 201, the console navigates
 * to /app as though it worked, and the SSR guard on /app finds no cookie and bounces straight back
 * to /login. Every post-login screenshot is then of the login page, and nothing reports an error.
 *
 * There is no credential to attach here: there isn't one yet. `same-origin` sends what exists
 * (nothing) and stores what arrives (the session cookie), which is the entire purpose of the call.
 */
export function anonClient(): ZipZapClient {
  return new ZipZapClient({ baseUrl: '/api', credentials: 'same-origin' });
}
