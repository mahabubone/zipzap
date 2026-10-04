/**
 * A merchant's webhook endpoint. Lives in `merchant` — it is per-merchant integration
 * config, managed with the credential that owns it (`webhooks:manage` scope).
 *
 * `secretHash`, never the secret: shown once at creation/rotation, then only the
 * hash remains — same shape as api_credentials, same reason. `events` is the
 * subscribed wire-event set; delivery fans out per endpoint per event.
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('webhook_endpoints')
export class WebhookEndpointEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Index('webhook_endpoints_merchant_idx')
  @Column('uuid')
  merchantId!: string;

  @Column('text')
  url!: string;

  @Column('text', { array: true })
  events!: string[];

  @Column('text')
  secretHash!: string;

  @Column('text')
  status!: 'ACTIVE' | 'PAUSED' | 'FAILING';

  @Column('integer')
  consecutiveFailures!: number;

  @Column('timestamptz', { nullable: true })
  lastSuccessAt!: Date | null;

  @Column('timestamptz', { nullable: true })
  lastFailureAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
