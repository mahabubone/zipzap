import { ZipZapClient } from '@zipzap/api-client';

/**
 * No session, by design. A recipient has a tracking code, not an account — this app must never be
 * able to send a bearer token even by accident.
 *
 * The base URL is relative, so it resolves against whatever origin the caller used: on the server
 * against this app's own request URL, and in the browser against the page. There is no configured API
 * host for the browser to hold, because the dev server and `web-host.mjs` both proxy `/api` onto the
 * API's own socket and rewrite `Origin` — which is what keeps the request same-origin from the API's
 * point of view (ADR-0016).
 *
 * It was `import.meta.env.VITE_API_URL ?? 'http://localhost:3000'`: a second origin, hard-coded, on
 * the one app where a recipient's browser is the whole threat surface. The dev server now proxies
 * `/api`, so the constant is gone rather than merely defaulted.
 */
export function anonClient(): ZipZapClient {
  return new ZipZapClient({ baseUrl: '/api' });
}
