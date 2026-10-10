import { defineConfig } from 'vitest/config';

/**
 * Vitest, node environment, colocated `*.spec.ts`.
 *
 * Matches the backend: the app's testable logic is the offline queue and the storage/session
 * helpers, none of which need a renderer. A component test needs react-native-testing-library and
 * a mock of everything native, which would be testing the mocks.
 *
 * The `include` is deliberately narrow. A wide glob picks up the `scripts/*.mjs` proofs, which are
 * standalone programs that call `process.exit` and would abort the run.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.expo/**'],
    globals: false,
  },
});
