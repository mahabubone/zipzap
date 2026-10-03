/**
 * Per-module TypeORM connections, each scoped to its own schema.
 *
 * ## What this actually enforces, precisely
 *
 * Setting `schema` sets the connection's `search_path`, so an UNQUALIFIED table name resolves
 * only inside the module's own schema. Writing `merchants` from the `shipment` connection fails.
 *
 * It does NOT stop someone writing `merchant.merchants` in full. That was verified against a
 * live database rather than assumed, and an earlier draft of this file and of ADR-0002 claimed
 * otherwise. Two mechanisms were tried and neither closed the gap:
 *
 *  - `SET ROLE` after `initialize()` covers one pooled client; TypeORM uses a pg Pool, so the
 *    next query may land on a different one.
 *  - a `pool.on('connect')` hook, because TypeORM does `new Pool(defaults, options.extra)` and
 *    never accepts a pre-built pool — a hook on our own Pool object never runs.
 *  - `role` in the pg config is ignored by node-postgres, and `options: '-c role=x'` fails
 *    because `role` is not a GUC.
 *
 * So qualified cross-schema access is caught by `scripts/check-boundaries.mjs` in CI, which is
 * a real gate rather than a convention.
 *
 * `ponytail:` runtime privilege isolation needs a Postgres role per module and a separate
 * connection credential for each — four more DSNs and four more secrets to manage. That is the
 * upgrade path when a deployment exists; until then the grep is the enforcement. See
 * docs/ADR/0002-postgresql-schema-boundaries.md.
 */

import type { DynamicModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, type EntityTarget } from 'typeorm';
import { config } from '../config';
import { pgTypesConfig } from './pg-types';
import { SnakeNamingStrategy } from './naming-strategy';
import type { ModuleSchema } from './schemas';

type Options = ConstructorParameters<typeof DataSource>[0];

export function moduleDataSourceOptions(
  schema: ModuleSchema,
  entities: readonly EntityTarget<unknown>[],
): Options {
  const { databaseUrl, nodeEnv } = config();

  return {
    type: 'postgres',
    url: databaseUrl,
    schema,
    entities: [...entities],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    logging: nodeEnv === 'development' ? ['error', 'warn'] : ['error'],
    // int8 must arrive as a number for money (ADR-0009).
    extra: { types: pgTypesConfig() },
  } as Options;
}

/** For tests and one-off tooling: build, connect, and return a role-scoped DataSource. */
export async function connectModuleDataSource(
  schema: ModuleSchema,
  entities: readonly EntityTarget<unknown>[],
): Promise<DataSource> {
  const dataSource = new DataSource(moduleDataSourceOptions(schema, entities));
  await dataSource.initialize();
  return dataSource;
}

/** Registers a schema-scoped, role-scoped connection for one module. Import from that module. */
export function forModule(
  schema: ModuleSchema,
  entities: readonly EntityTarget<unknown>[],
): DynamicModule {
  return TypeOrmModule.forRootAsync({
    name: schema,
    useFactory: () => moduleDataSourceOptions(schema, entities),
  });
}
