import { defineConfig } from 'vitest/config';

/**
 * Vitest, node environment, colocated `*.spec.ts`.
 *
 * Matches the backend: the app's testable logic is the offline queue and the storage/session
 * helpers, none of which need a renderer. A component test needs react-native-testing-library and
 * a mock of everything native, which would be testing the mocks.
 *
 * The `include` is `.spec.ts` only. The RN screens are deliberately not imported: they pull
 * `react-native` and `expo-*` in, which the node environment cannot parse — a spec for a screen's
 * projection belongs to pure code, not to the view.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.expo/**'],
    globals: false,
  },
});
