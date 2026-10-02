/**
 * snake_case column names, applied centrally.
 *
 * `ponytail:` TypeORM 1.x renamed `NamingStrategy` to `NamingStrategyInterface` and
 * changed `columnName`'s signature from (propertyName, customName) to
 * (propertyName, customName, embeddedPrefixes). 0.3.x examples do not compile here.
 */

import { DefaultNamingStrategy } from 'typeorm';

function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

export class SnakeNamingStrategy extends DefaultNamingStrategy {
  override tableName(targetName: string, userSpecifiedName: string | undefined): string {
    return userSpecifiedName ?? snakeCase(targetName);
  }

  override columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    if (customName) return customName;
    const prefix = embeddedPrefixes.length > 0 ? `${snakeCase(embeddedPrefixes.join('_'))}_` : '';
    return `${prefix}${snakeCase(propertyName)}`;
  }

  override relationName(propertyName: string): string {
    return snakeCase(propertyName);
  }

  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return snakeCase(`${relationName}_${referencedColumnName}`);
  }

  override joinTableName(firstTableName: string, secondTableName: string): string {
    return snakeCase(`${firstTableName}_${secondTableName}`);
  }
}
