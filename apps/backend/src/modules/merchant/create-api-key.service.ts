/**
 * CreateApiKeyService — mints a scoped machine credential. The secret is
 * returned once and stored as a scrypt hash; there is no retrieval path.
 */

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { generateKeyId, hashSecret } from '../../common/secret.ts';
import type { ApiScope } from '../../common/scopes.ts';

@Injectable()
export class CreateApiKeyService {
  constructor(@InjectDataSource('merchant') private readonly merchant: DataSource) {}

  async create(
    merchantId: string,
    scopes: ApiScope[],
  ): Promise<{ keyId: string; secret: string; scopes: ApiScope[] }> {
    const keyId = generateKeyId();
    const secret = `sk_${randomBytes(32).toString('base64url')}`;

    await this.merchant.query(
      `INSERT INTO merchant.api_credentials (id, merchant_id, key_id, secret_hash, scopes)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), merchantId, keyId, hashSecret(secret), scopes],
    );

    return { keyId, secret, scopes };
  }
}
