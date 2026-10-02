/**
 * Per-module TypeORM connections, each scoped to its own schema.
 *
 * This is the enforcement for ADR-0002, not a convenience. A connection whose `schema`
 * option is set can only see that schema, so a cross-module query fails at runtime rather
 * than silently succeeding in production and confusing someone later.
 *
 * `ponytail:` TypeORM 1.x made `EntityTarget` generic (`EntityTarget<unknown>`), and
 * `@nestjs/typeorm`'s `forRootAsync` factory must return *options*, not a DataSource.
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
    extra: { types: pgTypesConfig() },
  } as Options;
}

export function buildModuleDataSource(
  schema: ModuleSchema,
  entities: readonly EntityTarget<unknown>[],
): DataSource {
  return new DataSource(moduleDataSourceOptions(schema, entities));
}

/** Registers a schema-scoped connection for one module. Import from that module only. */
export function forModule(
  schema: ModuleSchema,
  entities: readonly EntityTarget<unknown>[],
): DynamicModule {
  return TypeOrmModule.forRootAsync({
    name: schema,
    useFactory: () => moduleDataSourceOptions(schema, entities),
  });
}
