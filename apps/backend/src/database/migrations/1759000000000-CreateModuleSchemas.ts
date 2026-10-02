/**
 * Create the 19 module schemas. One per module — the schema IS the boundary.
 * docs/architecture/database.md · docs/ADR/0002-postgresql-schema-boundaries.md
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';
import { MODULE_SCHEMAS } from '../schemas';

export class CreateModuleSchemas1759000000000 implements MigrationInterface {
  name = 'CreateModuleSchemas1759000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const schema of MODULE_SCHEMAS) {
      await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Destructive by design: dropping a schema drops that module's data. Never run in
    // production. Reverse in dependency order — `system` last, the outbox lives there.
    for (const schema of [...MODULE_SCHEMAS].reverse()) {
      await queryRunner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  }
}
