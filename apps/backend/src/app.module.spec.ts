import { describe, expect, it } from 'vitest';

/**
 * The whole module graph resolves — the check a per-feature spec cannot make.
 *
 * `finance-module.spec.ts` and `analytics-module.spec.ts` assert a controller is *registered*.
 * Neither can assert the module can *build*: `MerchantAnalyticsController` guards with
 * `ApiKeyGuard`, which injects `AuthenticateApiKeyService`, which only `IdentityModule` exports.
 * Omitting that import is a `UnknownDependenciesException` at boot — every unit spec still passes,
 * `pnpm dev` starts, and only a real boot (or this test) fails.
 *
 * `compile()` instantiates providers without running `onModuleInit`, so TypeORM never opens a
 * connection — this stays a unit test, not an integration one. It does still need the env
 * `config.ts` demands, which is why the imports below are dynamic and resolved *after* the
 * defaults are assigned: `config.ts` reads DATABASE_URL at module-evaluation time.
 */

const ENV_DEFAULTS = {
  DATABASE_URL: 'postgresql://zipzap:zipzap@localhost:5433/zipzap',
  REDIS_URL: 'redis://localhost:6381',
  NATS_URL: 'nats://localhost:4224',
} as const;

describe('AppModule dependency graph', () => {
  it('resolves every constructor dependency', async () => {
    for (const [name, value] of Object.entries(ENV_DEFAULTS)) {
      process.env[name] ??= value;
    }

    const { AppModule } = await import('./app.module.ts');
    const { Test } = await import('@nestjs/testing');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
  });
});
