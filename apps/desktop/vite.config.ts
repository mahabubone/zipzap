import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

/**
 * The Electron **main process** is Node. Not a browser target with Electron's name on it.
 *
 * This built as a browser library until `scripts/assert-node-build.mjs` was written, because Vite's
 * default `lib` target is the browser: it replaced `path` and `url` with empty browser shims and
 * still exited 0. The artefact was 2 kB of `u.join(...)` where `u.exports = {}`, so the kiosk shell
 * died on its first `file://` URL — after a green build, in a workspace nobody ran.
 *
 * `ssr: true` is the supported way to tell Vite the output runs in Node, and the built-ins are
 * listed as external as well, because a build that has to be told twice is a build that will be
 * told once.
 *
 * Two entries, because a main process with `contextIsolation: true` needs its preload beside it.
 * Without the second entry the preload path points at a file the build never wrote, and Electron
 * reports a missing preload at window creation — far from the config that forgot it.
 */
const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

export default defineConfig({
  build: {
    // Node 24 is the pinned runtime (see AGENTS.md); match the engine the app actually runs on.
    target: 'node24',
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        main: 'src/main.ts',
        preload: 'src/preload.ts',
      },
      external: ['electron', ...nodeBuiltins],
      output: {
        format: 'es',
        entryFileNames: '[name].js',
      },
    },
  },
});
