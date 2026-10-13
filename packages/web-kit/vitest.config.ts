import { defineConfig } from 'vitest/config';

/**
 * Vitest, node environment, colocated `*.spec.ts`.
 *
 * Node rather than jsdom: everything here is pure. `useAsync` is the only React export and it is
 * tested through its sibling `messageFor`, which is the part with decisions in it — the hook's own
 * behaviour is three `useState`s and an effect, and testing that in jsdom would buy a slower suite
 * and no new information.
 *
 * No `@vitejs/plugin-react` for the same reason the kit's own config omits it: no JSX here.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
