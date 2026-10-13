# ZipZap Desktop — Hub Console for Depot Machines

An Electron shell wrapping the hub-console web app, designed for shared depot machines.

## Features

- **Kiosk mode**: Full-screen, no browser chrome, no devtools, no right-click menu
- **Session persistence**: HttpOnly cookies persist across reboots via Electron's cookie store
- **Single sign-in**: One login per shift on shared hardware
- **Zero configuration**: Wraps the hub-console as-is; no additional setup needed

## Development

```bash
pnpm dev
```

Runs Electron with the hub-console dev server at `http://localhost:3000`.

## Production

```bash
pnpm build
pnpm start
```

Builds the main process and runs it against a running hub-console server (or pass `ELECTRON_START_URL=http://my-server:3000`).

## Kiosk Mode

Pass `--kiosk` to run in kiosk mode:

```bash
pnpm start -- --kiosk
```

This disables:

- Browser back/forward buttons
- Right-click context menu
- DevTools
- Window resizing
- Full exit (Alt+F4 on Windows, Cmd+Q on Mac)

## Architecture

The main process (`src/main.ts`) creates a single `BrowserWindow` and loads the hub-console at runtime. No build-time bundling of the web app; Electron simply points at the running console server.

For production deployment:

1. Build the hub-console to static files
2. Serve it from a local HTTP server or the same machine
3. Point `ELECTRON_START_URL` at it
4. Package with `electron-builder` or equivalent

The session cookie (`zipzap_session`) is stored in Electron's default cookie jar, persisting across app restarts.
