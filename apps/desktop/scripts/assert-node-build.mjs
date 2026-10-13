/**
 * Asserts the Electron bundle is a **Node** bundle.
 *
 * This file exists because `vite build` exited 0 while producing an artefact that could not run. The
 * default library target is the browser, so `path` and `url` were replaced with empty shims:
 *
 *     var u = ((a, t) => { t.exports = {} })(), ... preload: u.join(f, "preload.js")
 *
 * Green build, dead app — and the failure only appeared when someone launched it, which for a kiosk
 * shell at a depot is a truck with a dead screen. A build step that cannot produce this class of
 * artefact silently is the actual defect; this turns it into a failed build.
 *
 * Three assertions, all of them things the bundle must not contain:
 *   1. `path`/`url`/`node:*` are imported from Node, not shimmed.
 *   2. No browser-externalisation marker (`__vite-browser-external`) survived into the output.
 *   3. The preload entry was emitted, because `main.ts` names it in `webPreferences.preload`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');

if (!existsSync(join(dist, 'main.js'))) {
  console.error('dist/main.js missing — vite build did not emit an entry point.');
  process.exit(1);
}

const main = readFileSync(join(dist, 'main.js'), 'utf8');
const preloadPath = join(dist, 'preload.js');
const failures = [];

// 1. Node built-ins must arrive as imports. `from"path"` is the externalised form; a shim would have
//    no import line at all, only the `exports = {}` helper it gets bundled behind.
for (const builtin of ['path', 'url']) {
  const imported = new RegExp(`from\\s*["'](?:node:)?${builtin}["']`).test(main);
  if (!imported) {
    failures.push(
      `"${builtin}" is not imported from Node — it was bundled as a browser shim. ` +
        'Is `build.ssr` still set in vite.config.ts?',
    );
  }
}

// 2. The marker Vite/rollup leaves behind when it externalises a module for the browser.
if (main.includes('__vite-browser-external')) {
  failures.push(
    'dist/main.js contains __vite-browser-external — a browser build leaked into main.',
  );
}

// 3. The preload is referenced by the main process, so a missing file is a runtime error at window
//    creation rather than a build error.
if (!existsSync(preloadPath)) {
  failures.push('dist/preload.js missing — main.ts names it as the preload script.');
}

if (failures.length > 0) {
  console.error('Electron bundle is not a Node bundle:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('electron bundle ok — node built-ins external, preload emitted');
