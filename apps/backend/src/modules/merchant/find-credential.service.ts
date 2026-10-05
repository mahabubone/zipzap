/**
 * Credential lookup, owned by `merchant` because `merchant.api_credentials` is its table.
 *
 * Exposed as a service rather than a repository import so that identity can verify a key without
 * reading merchant's schema. This is the sanctioned cross-module path (ADR-0002): an injected
 * service, not a table access.
 *
 * Returning merchant status alongside the credential is deliberate — deciding whether a key may
 * act requires the merchant's lifecycle state, and that state is the merchant module's business.
 */

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { MerchantStatus } from './rules/merchant.ts';

export interface FoundCredential {
  readonly id: string;
  readonly merchantId: string;
  readonly merchantName: string;
  readonly merchantStatus: MerchantStatus;
  readonly secretHash: string;
  readonly scopes: string[];
  readonly revokedAt: Date | null;
  /** Per-contract override, req/min. NULL = tier default (migration 0022). */
  readonly rateLimitPerMin: number | null;
}

@Injectable()
export class FindCredentialService {
  constructor(@InjectDataSource('merchant') private readonly merchant: DataSource) {}

  /** Own schema only. Table names are schema-qualified because TypeORM's `schema` option
   * sets search_path for the query builder, not for raw SQL — an unqualified name resolves
   * against whatever search_path the session happens to have. See module-connection.ts. */
  async findByKeyId(keyId: string): Promise<FoundCredential | null> {
    const rows = await this.merchant.query(
      `SELECT c.id,
              c.merchant_id,
              c.secret_hash,
              c.scopes,
              c.revoked_at,
              m.name       AS merchant_name,
              m.status     AS merchant_status,
              m.rate_limit_per_min
         FROM merchant.api_credentials c
         JOIN merchant.merchants m ON m.id = c.merchant_id
        WHERE c.key_id = $1`,
      [keyId],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      merchantId: row.merchant_id,
      merchantName: row.merchant_name,
      merchantStatus: row.merchant_status,
      secretHash: row.secret_hash,
      scopes: row.scopes ?? [],
      revokedAt: row.revoked_at,
      rateLimitPerMin: row.rate_limit_per_min ?? null,
    };
  }

  async touchLastUsed(credentialId: string): Promise<void> {
    await this.merchant.query(
      `UPDATE merchant.api_credentials SET last_used_at = now() WHERE id = $1`,
      [credentialId],
    );
  }
}
