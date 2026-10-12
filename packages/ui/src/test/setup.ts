import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Unmount between tests. RTL registers `cleanup` on `afterEach` itself only when it detects a
 * global test runner that does not already do it; doing it explicitly keeps the DOM empty
 * between specs regardless of how the runner is configured, so a test can never pass on a node
 * a previous test left behind.
 */
afterEach(() => {
  cleanup();
});
