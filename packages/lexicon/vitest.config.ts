import { defineConfig } from 'vitest/config';

/**
 * Vitest, node environment, colocated `*.spec.ts`.
 *
 * No jsdom and no React: everything here is a function over strings and integers, and the point of
 * the package is that it can be asserted without rendering anything. Both of its consumers are
 * renderers — the browser kit and the rider's screens — and this is the layer below both.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
