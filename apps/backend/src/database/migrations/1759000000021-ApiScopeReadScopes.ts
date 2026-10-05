/**
 * Adds cod:read + returns:read to merchant.api_scope.
 *
 * GET /v1/cod was guarded by delivery:read (wrong — a delivery-scoped
 * credential could read COD money) and GET /v1/returns by returns:write
 * (wrong direction — a read needing a write scope). The scopes table is the
 * Vocabulary; the enum is its database shadow. Additive, online-safe.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ApiScopeReadScopes1759000000021 implements MigrationInterface {
  name = 'ApiScopeReadScopes1759000000021';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TYPE merchant.api_scope ADD VALUE IF NOT EXISTS 'cod:read'`);
    await r.query(`ALTER TYPE merchant.api_scope ADD VALUE IF NOT EXISTS 'returns:read'`);
  }

  public async down(): Promise<void> {
    // Intentionally a no-op: enum values are append-only.
  }
}
