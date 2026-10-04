/**
 * One delivery attempt. Append-only by trigger — the dispute evidence.
 *
 * A delivery (one event to one endpoint) fans out to attempts (one row per try).
 * `terminal` marks the end of the ladder: delivered, or permanently failed, or
 * past the last retry. Never updated, never deleted.
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('webhook_deliveries')
export class WebhookDeliveryEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Index('webhook_deliveries_endpoint_idx')
  @Column('uuid')
  endpointId!: string;

  @Column('uuid')
  merchantId!: string;

  @Column('text')
  eventType!: string;

  @Column('jsonb')
  payload!: Record<string, unknown>;

  @Column('integer')
  attempt!: number;

  @Column('integer', { nullable: true })
  statusCode!: number | null;

  @Column('text', { nullable: true })
  responseBody!: string | null;

  @Column('text', { nullable: true })
  error!: string | null;

  @Column('boolean')
  delivered!: boolean;

  @Column('boolean')
  terminal!: boolean;

  @CreateDateColumn()
  attemptedAt!: Date;
}
