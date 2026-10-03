/**
 * An API credential. The secret is stored as a hash and is never retrievable — there is no
 * "show me the secret" path, because there must not be one.
 *
 * `keyId` is a public identifier and is safe to log. The secret is not.
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import type { ApiScope } from '../../../../common/scopes.ts';

@Entity('api_credentials')
export class ApiCredentialEntity {
  @PrimaryColumn('uuid')
  id!: string;

  /** An identifier. This table lives in `merchant`, so a real FK is legitimate here. */
  @Index('api_credentials_merchant_idx')
  @Column('uuid')
  merchantId!: string;

  @Index('api_credentials_key_id_idx', { unique: true })
  @Column('text')
  keyId!: string;

  @Column('text')
  secretHash!: string;

  @Column('text', { array: true })
  scopes!: ApiScope[];

  @Column('timestamptz', { nullable: true })
  lastUsedAt!: Date | null;

  @Column('timestamptz', { nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
