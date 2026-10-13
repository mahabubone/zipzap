# ZipZap Desktop — Hub Console for Depot Machines

An Electron shell wrapping the hub-console web app, for a shared depot machine: a screen bolted to
a wall that one person signs into, uses, and leaves signed in.

## What it does

- **Kiosk mode** (`--kiosk`): full screen, no window chrome.
- **Walled in.** The shell refuses to navigate away from its origin and refuses to open a second
  window. A `<webview>` is blocked outright. Without this, a stale link in an email walks a depot's
  terminal off the console, and the depot is responsible for whatever is on screen afterwards.
- **No context menu, no devtools shortcuts** — unless the shell was pointed at a localhost URL, which
  is how a developer recognises a dev server rather than an env var nobody sets.
- **Session persistence**: the HttpOnly session cookie lives in Electron's cookie jar, so one sign-in
  covers a shift and survives a restart of the app.

## Running it

```bash
# Terminal one — the console this shell wraps
pnpm --filter @zipzap/hub-console dev            # http://localhost:5176

# Terminal two
ELECTRON_START_URL=http://localhost:5176 pnpm --filter @zipzap/desktop dev
```

`ELECTRON_START_URL` is **required**. There is no default, and its absence is a message rather than a
blank window: the old fallback resolved to a `file://…/dist/index.html` that never existed — wrong
path, and the wrong shape of output, because the hub console is a server-rendered app rather than a
static bundle.

## Kiosk mode

```bash
ELECTRON_START_URL=https://console.example.com pnpm --filter @zipzap/desktop start -- --kiosk
```

| Claim                   | What actually happens                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| Full screen, no chrome  | `kiosk: true` on the window                                                                   |
| Right-click menu        | Suppressed on every build — the shell is the product, so "production" was always true         |
| DevTools                | Keyboard shortcuts blocked against a non-localhost origin; `openDevTools()` against localhost |
| Cannot leave the app    | `will-navigate` is refused for any other origin; new windows are denied                       |
| No `<webview>`          | `will-attach-webview` refused                                                                 |
| Window resizing, Alt+F4 | **Not implemented.** These are Electron defaults, not controls this shell owns                |

That last row is the one to be honest about: it was claimed here before it was true. Locking a kiosk
against Alt+F4 needs an OS-level policy (a window manager, a session kiosk), not a web API.

## Build

```bash
pnpm --filter @zipzap/desktop build     # vite build, then an assertion about the artefact
```

The build step ends in `scripts/assert-node-build.mjs`, which fails if `path`/`url` are not imported
from Node or if the preload is missing. That assertion exists because the build used to succeed while
emitting a bundle with browser shims in it — `vite`'s library target is the browser, and an Electron
main process is not.

## Deployment

The hub console is a server-rendered app, so a depot machine needs something serving it:

1. Build and run the hub console's Node server (`pnpm --filter @zipzap/hub-console build`, then
   `node .output/server/index.mjs` behind whatever serves your depot network).
2. Point `ELECTRON_START_URL` at that origin.
3. Package with `electron-builder` — not configured here.

## Architecture

One `BrowserWindow`, one preload, no Node access in the page. The preload exists and is deliberately
empty: `contextIsolation: true` with no preload gives no isolated world at all, so shipping an empty
one makes "this app exposes nothing to the page" a decision in the repository rather than a default.
Anything added to it crosses `contextBridge` and is therefore part of the console's public surface.
