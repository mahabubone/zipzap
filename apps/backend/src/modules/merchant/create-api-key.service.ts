/**
 * CreateApiKeyService — mints a scoped machine credential. The secret is
 * returned once and stored as a scrypt hash; there is no retrieval path.
 *
 * Minting a credential is audited in the SAME transaction as the insert. A key that exists with no
 * audit row is the exact artefact a credential-abuse investigation is looking for, and it must be
 * impossible to produce by an oversight here.
 */

import { Injectable, Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { generateKeyId, hashSecret } from '../../common/secret.ts';
import type { ApiScope } from '../../common/scopes.ts';
import { AuditService } from '../system/audit.service.ts';

export interface ApiKeyCreation {
  readonly merchantId: string;
  readonly scopes: ApiScope[];
  /** Who minted it — the session or key id of the caller. */
  readonly actorId?: string | null;
  readonly actorType?: 'human' | 'machine';
  readonly requestId?: string | null;
  readonly ip?: string | null;
}

@Injectable()
export class CreateApiKeyService {
  constructor(
    @InjectDataSource('merchant') private readonly merchant: DataSource,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(
    merchantId: string,
    scopes: ApiScope[],
    context?: Omit<ApiKeyCreation, 'merchantId' | 'scopes'>,
  ): Promise<{ keyId: string; secret: string; scopes: ApiScope[] }> {
    const keyId = generateKeyId();
    const secret = `sk_${randomBytes(32).toString('base64url')}`;
    const credentialId = randomUUID();

    await this.merchant.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO merchant.api_credentials (id, merchant_id, key_id, secret_hash, scopes)
         VALUES ($1, $2, $3, $4, $5)`,
        [credentialId, merchantId, keyId, hashSecret(secret), scopes],
      );
      await this.audit.record(
        {
          actorType: context?.actorType ?? 'human',
          actorId: context?.actorId ?? null,
          merchantId,
          action: 'credential.minted',
          targetType: 'api_credential',
          targetId: credentialId,
          requestId: context?.requestId ?? null,
          ip: context?.ip ?? null,
          // key_id, never the secret and never secret_hash. The denylist would reject both keys;
          // recording the hash would be pointless even if it were allowed.
          metadata: { keyId, scopes, scopeCount: scopes.length },
        },
        manager,
      );
    });

    return { keyId, secret, scopes };
  }
}
