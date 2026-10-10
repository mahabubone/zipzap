import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * The API is at `/api` on THIS origin.
 *
 * A dev-only proxy, so there is exactly one origin in the browser — the console's. That is what
 * makes the `zipzap_session` cookie first-party: the browser's `SameSite` rules and the CSRF
 * middleware both compare origins, and a request to `:3000` from `:5173` is a different origin, no
 * matter how local it looks. Cross-origin "worked" only because the token was in `sessionStorage`
 * and attached by hand; it cannot work for a cookie without `SameSite=None`, which is both a
 * deprecated third-party cookie and no CSRF protection at all.
 *
 * `API_ORIGIN` is where the backend actually listens. It is a server-side variable, read by the
 * Vite dev server and never bundled into the browser — which is why the app has no `VITE_API_URL`
 * any more: there is no API URL left for the client to know.
 */
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  // tanstackStart() registers the router plugin, which must precede react() —
  // it resolves /@react-refresh from react() and throws without it.
  plugins: [tanstackStart(), react(), tailwindcss()],
  ssr: { noExternal: ['@zipzap/ui', '@zipzap/api-client'] },
  server: {
    proxy: {
      '/api': {
        target: apiOrigin,
        changeOrigin: true,
        // Strip the `/api` prefix. Vite does NOT do this by itself — a matching key with no
        // `rewrite` forwards the path verbatim, so `/api/v1/shipments` arrives as
        // `/api/v1/shipments` and 404s against a backend that mounts everything at `/v1`.
        // The symptom is a 404 with the API's own `x-request-id` in it, which looks like a routing
        // bug in the backend rather than a proxy bug in the console.
        rewrite: (path) => path.replace(/^\/api/, '') || '/',
        // The backend sets `Set-Cookie: zipzap_session=…; HttpOnly; Secure; SameSite=Lax; Path=/`.
        // `Secure` is required by the session contract, and over plain HTTP on localhost the
        // browser would otherwise drop the cookie as soon as it arrived — which looks exactly like
        // a login that succeeds and then forgets you. `secure: false` is the dev escape hatch for
        // that; the header still says Secure, so nothing about the contract is tested away, and
        // production runs under HTTPS where the attribute is honoured as written.
        secure: false,
        // `changeOrigin` alone is not enough. It rewrites Host to the API's, but leaves `Origin`
        // pointing at the console — so the backend sees `Origin: localhost:5173` against
        // `Host: localhost:3000` and its CSRF middleware reads that as a cross-site POST and
        // rejects it with a 401 that looks exactly like a bad password. Rewriting Origin to the
        // API's own origin is what makes the request genuinely same-origin from the API's
        // perspective, which is the whole arrangement.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const target = new URL(apiOrigin);
            proxyReq.setHeader('Host', target.host);
            proxyReq.setHeader('Origin', apiOrigin);
            // `Sec-Fetch-Site` is a browser-set header the proxy must not forward as-is: it says
            // "cross-site" for a request the browser sent to the console, which the API would
            // again read as a CSRF signal. The proxied request is not cross-site.
            proxyReq.removeHeader('sec-fetch-site');
            proxyReq.removeHeader('sec-fetch-mode');
            proxyReq.removeHeader('sec-fetch-dest');
          });
        },
      },
    },
  },
});
