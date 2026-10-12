/**
 * The production host for a TanStack Start app. One process, three jobs.
 *
 * `vite build` for a TanStack Start 1.x app does not produce a static bundle — it produces
 * `dist/client/assets` (the browser half) and `dist/server/server.js`, whose default export is a
 * *fetch handler*, not an HTTP server. Something has to put a socket in front of it, and for the
 * console that something also owns the `/api` hop. So it is here, in one file, rather than split
 * across nginx config and a process supervisor.
 *
 * nginx was the other option and it loses on both counts: the app is server-rendered, so nginx would
 * need a supervisor running two processes in one container (a third image, or a hand-rolled PID 1),
 * and the `/api` rules below are four headers whose *whole purpose* is to be read next to the ADR
 * that explains them. Splitting them into `nginx.conf` and this file would put the explanation on
 * one side and the behaviour on the other.
 *
 * Everything is resolved relative to this file, so the image can be moved without editing anything:
 *   <app>/dist/web-host.mjs  <- this file
 *   <app>/dist/client        <- hashed browser assets, immutable
 *   <app>/dist/server        <- the SSR fetch handler
 */

import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('.', import.meta.url));
const CLIENT_DIR = join(DIST, 'client');
const SERVER_ENTRY = join(DIST, 'server', 'server.js');

const PORT = Number(process.env.PORT ?? 4173);
/**
 * Where the backend actually listens, read here at runtime rather than baked in at build time.
 *
 * It is the mirror image of `API_ORIGIN` in each app's vite.config.ts: that one is read by the dev
 * server, this one by the production proxy. Same variable, same meaning, same reason — the browser
 * never learns it, which is the entire point of ADR-0016.
 */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://api:3000';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Reverse-proxies `/api/*` to the backend, byte for byte what the Vite dev proxy does.
 *
 * All four behaviours below are load-bearing, and all four are commented in
 * apps/frontends/merchant-web/vite.config.ts. This is the production copy of that comment block,
 * and it is duplicated rather than shared because a dev-time module in `apps/` cannot be imported
 * from an image without dragging the app's toolchain along with it.
 */
async function proxyApi(request, pathname, search, headers) {
  const target = new URL(API_ORIGIN);
  // Strip the `/api` prefix. A matching location with no rewrite forwards the path verbatim, so
  // `/api/v1/shipments` arrives as `/api/v1/shipments` and 404s against a backend that mounts
  // everything at `/v1` — a 404 carrying the API's own `x-request-id`, which reads as a routing bug
  // in the backend rather than a proxy bug here.
  const path = pathname.replace(/^\/api/, '') || '/';

  // `Host` alone is not enough, and neither is `Origin`. The backend's CSRF check compares
  // `new URL(origin).host` against `x-forwarded-host ?? host` (apps/backend/src/common/
  // csrf.middleware.ts). Rewriting `Host` to the API's own while leaving `Origin` pointing at the
  // console makes the request read as cross-site, and a cross-site POST is rejected with a 401 that
  // is indistinguishable from a wrong password.
  headers.set('host', target.host);
  headers.set('origin', target.origin);

  // Browser-set, and truthful about what the *browser* saw, which is not what the API is being told
  // here. Forwarding `sec-fetch-site: same-origin` would be harmless today, but forwarding
  // `sec-fetch-site: cross-site` — which a future frontend could produce — would be a CSRF
  // rejection with no visible cause. The proxied request is not cross-site; say so by omission.
  headers.delete('sec-fetch-site');
  headers.delete('sec-fetch-mode');
  headers.delete('sec-fetch-dest');

  // Conditional requests describe a cache neither end of this hop controls, so answering "not
  // modified" here would hand the browser a 304 it would render as an empty page. `accept-encoding`
  // goes for the same reason: undici decodes the body for us, so a `content-encoding` on the way
  // back would describe bytes the client is not receiving.
  headers.delete('if-none-match');
  headers.delete('if-modified-since');
  headers.delete('accept-encoding');

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return fetch(`${target.origin}${path}${search}`, {
    method: request.method,
    headers,
    body: hasBody ? (Readable.toWeb(request) ?? undefined) : undefined,
    // Required by undici whenever the body is a stream, and the price of not buffering a 10MB bulk
    // CSV import through memory to move it thirty metres.
    ...(hasBody ? { duplex: 'half' } : {}),
    redirect: 'manual',
  });
}

/**
 * The incoming Node headers as a web `Headers`, minus `host`.
 *
 * `host` is excluded because every path here sets it deliberately — to the API's own for a proxied
 * request, and to the browser's own for SSR so the app can resolve its relative `/api` against the
 * origin the visitor actually used. Copying it first and overwriting it afterwards would be the
 * same result by accident.
 */
function forwardableHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key === 'host') continue;
    // Node hands `set-cookie` in as an array and everything else as a string; Headers wants appends.
    if (Array.isArray(value)) for (const entry of value) headers.append(key, entry);
    else headers.set(key, value);
  }
  return headers;
}

/**
 * Serves a file from `dist/client`, or returns null so the caller falls through to SSR.
 *
 * Returns null rather than throwing 404: TanStack Start owns its own routes, and a request for a
 * path that happens to collide with a filename is a route, not a file.
 */
function serveStatic(pathname) {
  if (pathname.includes('\0')) return null;
  const relative = normalize(pathname).replace(/^([/\\])+/, '');
  // A `..` that survived normalisation would escape dist/client and serve the image's filesystem.
  if (relative.split(/[/\\]/).includes('..')) return null;

  const file = join(CLIENT_DIR, relative);
  if (!file.startsWith(CLIENT_DIR + sep)) return null;

  // `statSync` rather than trusting the path: a directory would otherwise be opened as a file and
  // fail later, after headers were already sent.
  try {
    if (!statSync(file).isFile()) return null;
  } catch {
    return null;
  }
  return file;
}

/**
 * The request as the SSR handler wants it.
 *
 * The URL is rebuilt from the `Host` header rather than from a hardcoded origin, because
 * `src/lib/request-context.ts` resolves its relative `/api` base URL with
 * `new URL(request.url).origin` — and `routes/app.tsx`'s guard resolves it into a server-side fetch
 * back to this same origin. That fetch is why `PORT` inside the container is deliberately the same
 * number the host publishes: the app asks itself for `/api/…` on the port the browser used, and the
 * answer has to be this process.
 */
function toWebRequest(req) {
  const host = req.headers.host ?? `localhost:${PORT}`;
  // `host` IS forwarded here, unlike on the `/api` path: SSR has to see the origin the browser used.
  const headers = forwardableHeaders(req);
  headers.set('host', host);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(new URL(req.url ?? '/', `http://${host}`), {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    ...(hasBody ? { duplex: 'half' } : {}),
  });
}

async function sendWebResponse(response, res) {
  res.writeHead(response.status, response.headers);
  if (!response.body) return res.end();
  // `Readable.fromWeb` is the only way to get a Node stream out of a web ReadableStream, and the
  // handler streams SSR HTML rather than buffering it, so this is the difference between a
  // constant memory profile and a peak proportional to the page.
  Readable.fromWeb(response.body).pipe(res);
}

/**
 * The SSR handler, loaded once at boot.
 *
 * Not per request, even though Node caches ESM modules and it would have worked: a build where the
 * entry is missing or throws should crash the container at startup, where the reason is one line
 * of logs, rather than 500 every page with the same buried stack.
 */
const ssr = (await import(SERVER_ENTRY)).default;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${PORT}`}`);

    // Liveness for the container, answered without touching the SSR handler. `/healthz` on the app
    // is not the API's `/healthz` (apps/backend/src/health/health.controller.ts) and must not
    // borrow its meaning: this one proves the Node process is serving, nothing about dependencies.
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok' }));
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const response = await proxyApi(req, url.pathname, url.search, forwardableHeaders(req));
      // `content-encoding` is dropped because undici already decoded the body: forwarding it would
      // tell the client to decompress plain bytes. Everything else, `set-cookie` included, passes
      // through — that header is the session, and a proxy that rewrites it rewrites the product.
      const headers = [...response.headers].filter(([name]) => name !== 'content-encoding');
      res.writeHead(response.status, headers);
      if (!response.body) return res.end();
      return Readable.fromWeb(response.body).pipe(res);
    }

    const file = serveStatic(url.pathname);
    if (file) {
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        // Vite fingerprints everything under assets/, so it can be cached forever. A bare
        // `Cache-Control: no-cache` on the whole app would re-download every route on every
        // navigation and make the console feel slower than the dev server it replaced.
        'cache-control': url.pathname.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      });
      return createReadStream(file).pipe(res);
    }

    return await sendWebResponse(await ssr.fetch(toWebRequest(req)), res);
  } catch (error) {
    // A stack trace on stderr and a bare 500 to the browser. The SSR handler has its own error
    // boundary for render failures; reaching here means the host itself failed, which is a 500 with
    // no page and a log line a reviewer can act on.
    console.error('[web-host]', error);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[web-host] listening on :${PORT}, /api -> ${API_ORIGIN}`);
});

// Containers get SIGTERM on `docker compose down` and then ten seconds. Without this the Node
// process would be killed mid-render instead of draining.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
