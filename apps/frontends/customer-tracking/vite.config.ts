import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:3000';

/**
 * The public tracking app, which is the one surface here with no session — and is therefore the one
 * that most needs the API to be genuinely unreachable from the browser.
 *
 * It talked to the API cross-origin (`VITE_API_URL`, default `http://localhost:3000`) while its three
 * siblings proxied `/api` on their own origin. That is not a stylistic difference: ADR-0016 rests on
 * the session cookie being first-party, and a hard-coded absolute API origin hands the browser a
 * second origin that the proxy — the thing rewriting `Origin`, stripping `sec-fetch-*` and keeping
 * `SameSite=Lax` meaningful — never gets to see. A CSRF defence that is bypassed on one app out of
 * four is not a defence.
 *
 * `VITE_API_URL` is gone for the same reason it is gone elsewhere: there is no API URL for the
 * browser to know. The origin is a server-side variable; the browser only ever asks this origin.
 */
export default defineConfig({
  // tanstackStart() registers the router plugin, which must precede react() —
  // it resolves /@react-refresh from react() and throws without it.
  plugins: [tanstackStart(), react(), tailwindcss()],
  ssr: { noExternal: ['@zipzap/ui', '@zipzap/api-client'] },
  server: {
    // Pinned, and `strictPort` so a collision is loud rather than silently relocating the app.
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiOrigin,
        changeOrigin: true,
        // Strip the `/api` prefix: a matching key with no `rewrite` forwards the path verbatim, so
        // `/api/v1/tracking/ZP-1` arrives as `/api/v1/…` and 404s against a backend that mounts
        // everything at `/v1`.
        rewrite: (path) => path.replace(/^\/api/, '') || '/',
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const target = new URL(apiOrigin);
            proxyReq.setHeader('Host', target.host);
            proxyReq.setHeader('Origin', apiOrigin);
            // `Sec-Fetch-Site` is browser-set and would say "cross-site" for a request this app
            // made to itself. It is the API's CSRF signal, so the proxy has to remove it rather
            // than forward it.
            proxyReq.removeHeader('sec-fetch-site');
            proxyReq.removeHeader('sec-fetch-mode');
            proxyReq.removeHeader('sec-fetch-dest');
          });
        },
      },
    },
  },
});
