import { defineConfig } from 'vitest/config';

/**
 * Vitest, jsdom, colocated `*.spec.tsx`.
 *
 * The kit ships to apps that render in a browser, so its tests run in one too. `jsdom` (not
 * happy-dom) because the suite asserts on focus order, Escape handling and document-level
 * listeners — `Dropdown` and `Dialog` register those on `document`/`window`, and only jsdom
 * dispatches them faithfully enough to test click-outside and keydown-to-close.
 *
 * No `@vitejs/plugin-react` here. Every component is plain TSX with no Fast Refresh and no
 * HMR-only transform, so esbuild's automatic JSX runtime — driven by `tsconfig.json`, which
 * already sets `jsx: react-jsx` — produces identical output with one less dependency to drift.
 *
 * No Tailwind plugin either. The suite asserts on roles, labels and text, never on class
 * strings, so there is nothing for the Tailwind transform to do.
 *
 * `isolate: false` is the one non-obvious setting. The first run of this suite spent 48% of its
 * wall clock constructing a jsdom environment — once per file, 24 times — to pay for a cost that
 * is pure setup. Reusing workers across files removes it. It is safe here because every test
 * cleans up: `afterEach(cleanup)` unmounts the tree, and this kit holds no module-level mutable
 * state that a file could observe from another. A suite that added a shared cache or a
 * `document.body` mutation at import time would need this turned back off.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    isolate: false,
    include: ['src/**/*.spec.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
