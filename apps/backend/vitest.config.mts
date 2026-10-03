/**
 * Unit tests run colocated with source as *.spec.ts, from smallest scope outward:
 * *.rules.spec.ts (pure, zero DI) -> service/path specs (Nest DI via @nestjs/testing).
 *
 * DB-backed tests are NOT here: test/integration/*.test.ts runs against a live database
 * (node --test) because decorating-container tests add no value there and Vitest's
 * worker reuse fights connection pooling.
 */

import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    globals: false,
    testTimeout: 10_000,
    // Decorated specs boot the Nest container; reloading it per file is slow and can
    // leak connections across forks. Sequential files, parallel tests within a file.
    pool: 'forks',
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      exclude: [...coverageConfigDefaults.exclude, '**/*.module.ts', 'src/worker.ts', 'src/main.ts', 'src/publisher.ts'],
    },
  },
});
