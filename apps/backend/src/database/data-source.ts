/**
 * DataSource for migrations and the CLI. Not the application connection.
 *
 * Application connections are created per module, each scoped to its own schema, so a
 * cross-module query fails at runtime rather than silently succeeding (ADR-0002).
 */

import { DataSource } from 'typeorm';
import { config } from '../config';
import { pgTypesConfig } from './pg-types';
import { SnakeNamingStrategy } from './naming-strategy';
import { MODULE_SCHEMAS } from './schemas';

export const MIGRATIONS = [__dirname + '/migrations/*{.ts,.js}'];

export function buildDataSource(): DataSource {
  const { databaseUrl, nodeEnv } = config();
  return new DataSource({
    type: 'postgres',
    url: databaseUrl,
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    logging: nodeEnv === 'development' ? ['error', 'warn'] : ['error'],
    extra: { types: pgTypesConfig() },
    migrations: MIGRATIONS,
    migrationsTableName: 'system_migrations',
  });
}

export const dataSource = buildDataSource();

export { MODULE_SCHEMAS };
