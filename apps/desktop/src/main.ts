import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Electron main process for the ZipZap hub console desktop app.
 *
 * This is a kiosk-mode shell wrapping the hub-console web app for depot machines.
 * A single sign-in persists across reboots via HttpOnly cookies stored in Electron's
 * cookie jar. No browser chrome, no devtools, no right-click — just the hub console
 * full-screen on shared hardware.
 */

let mainWindow: BrowserWindow | null = null;

/**
 * Where the shell points.
 *
 * `ELECTRON_START_URL` is required, and its absence is a loud failure rather than a blank window.
 *
 * It used to fall back to `file://<repo>/frontends/hub-console/dist/index.html`, which is two
 * mistakes stacked: the path climbs one directory too far and lands outside `apps/`, and the hub
 * console is a TanStack **Start** app whose build output is a Node server bundle, not a static
 * `index.html`. So the fallback resolved to a file that does not exist, and `pnpm start` opened a
 * white window inside an operator-shaped chrome — the most confusing failure this package could have.
 *
 * There is no sensible default because there are two real modes: the console's dev server while
 * working on it, and a deployment's URL on a depot machine. Both are known to whoever starts the
 * shell, and neither can be guessed.
 */
const startUrl = process.env.ELECTRON_START_URL;

if (!startUrl) {
  console.error(
    [
      'ELECTRON_START_URL is not set, so there is nothing to open.',
      '',
      '  pnpm --filter @zipzap/hub-console dev            # then:',
      '  ELECTRON_START_URL=http://localhost:5176 pnpm --filter @zipzap/desktop dev',
      '',
      '  ELECTRON_START_URL=https://console.example.com pnpm --filter @zipzap/desktop start',
      '',
      'A kiosk at a depot points at a deployment; a developer points at the dev server.',
      'Guessing either one produced a white window.',
    ].join('\n'),
  );
  app.exit(1);
}

/** Same scheme, host and port. The path may change: that is the console navigating. */
function isSameOrigin(candidate: string, base: string): boolean {
  try {
    const a = new URL(candidate);
    const b = new URL(base);
    return a.protocol === b.protocol && a.host === b.host;
  } catch {
    return false;
  }
}

/** A local origin is somebody's dev server, and a dev server is allowed its devtools. */
function isDevServer(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function createWindow() {
  const url = startUrl!;
  mainWindow = new BrowserWindow({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Present and deliberately empty: see src/preload.ts. With no preload there is no isolated
      // world at all, and the security posture would be whatever Electron defaults to rather than
      // something this repository chose.
      preload: path.join(__dirname, 'preload.js'),
    },
    // Kiosk mode: full screen, no chrome. Opt-in, because the same shell is useful windowed while
    // developing the console it wraps.
    kiosk: process.argv.includes('--kiosk'),
    show: false,
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  /**
   * Kiosk hardening — all of it promised in this package's README, none of it implemented.
   *
   * A shell on a depot's shared hardware is the one place where "the page could open another page"
   * and "the operator could wander off the console" are real: both leave the terminal showing
   * something the depot is responsible for.
   */
  mainWindow.webContents.setWindowOpenHandler(({ url: requested }) => {
    // Denied by default. A console has no legitimate reason to spawn a window on top of a kiosk.
    if (!isSameOrigin(requested, url)) console.warn(`blocked a window open: ${requested}`);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, requested) => {
    // Same window, somewhere else: a stale link in an email, and the kiosk leaves the app.
    if (!isSameOrigin(requested, url)) {
      event.preventDefault();
      console.warn(`blocked a navigation to ${requested}`);
    }
  });

  mainWindow.webContents.on('will-attach-webview', (event) => {
    // A `<webview>` is Node access with extra steps, and this console has no use for one.
    event.preventDefault();
  });

  // The context menu is suppressed everywhere rather than only in production: the shell *is* the
  // product here, so "production" was always true, and the condition was decoration.
  mainWindow.webContents.on('context-menu', () => {
    // Silently ignored. A context menu on a depot terminal offers "Inspect element".
  });

  if (isDevServer(url)) {
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      // F12, Ctrl+Shift+I/J/C.
      if (input.key === 'F12') event.preventDefault();
      if (input.control && input.shift && 'ijc'.includes(input.key.toLowerCase())) {
        event.preventDefault();
      }
    });
  }

  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  // On macOS, keep the app active until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (mainWindow === null) {
    createWindow();
  }
});

/**
 * Handle app quitting gracefully.
 * On Windows, Squirrel.Windows will run the app with `--squirrel-install` and other args
 * on first run. A real app would check for those and handle them; this is a simplified version.
 */
if (process.platform === 'win32' && process.argv.includes('--squirrel-install')) {
  app.quit();
}
