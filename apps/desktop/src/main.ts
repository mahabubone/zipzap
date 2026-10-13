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

function createWindow() {
  mainWindow = new BrowserWindow({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    // Kiosk mode: full screen, no chrome
    kiosk: process.argv.includes('--kiosk'),
    show: false,
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Disable right-click context menu in production
  if (process.env.NODE_ENV === 'production') {
    mainWindow.webContents.on('context-menu', () => {
      // Silently ignore right-click
    });
  }

  // Disable DevTools in production
  if (process.env.NODE_ENV !== 'development') {
    mainWindow.webContents.on('before-input-event', (event: any, input: any) => {
      // Block F12 (DevTools), Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
      if (
        input.control &&
        input.shift &&
        (input.key.toLowerCase() === 'i' ||
          input.key.toLowerCase() === 'j' ||
          input.key.toLowerCase() === 'c')
      ) {
        event.preventDefault();
      }
      if (input.key === 'F12') {
        event.preventDefault();
      }
    });
  }

  const startUrl =
    process.env.ELECTRON_START_URL ||
    `file://${path.join(__dirname, '../../../frontends/hub-console/dist/index.html')}`;
  mainWindow.loadURL(startUrl);

  // Show window once ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Open devtools in development
  if (process.env.ELECTRON_START_URL) {
    mainWindow.webContents.openDevTools();
  }
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
