/**
 * Notification entities. Own schema `notification` only.
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('templates')
export class NotificationTemplateEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('text')
  name!: string;

  @Column('integer')
  version!: number;

  @Column('text')
  channel!: 'sms' | 'email' | 'push';

  @Column('text')
  locale!: string;

  @Column('text')
  body!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('messages')
@Index('messages_dedupe_idx', ['eventId', 'channel', 'recipient'], { unique: true })
@Index('messages_status_created_idx', ['status', 'createdAt'])
export class NotificationMessageEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('text')
  eventId!: string;

  @Column('text')
  channel!: 'sms' | 'email' | 'push';

  @Column('text')
  recipient!: string;

  @Column('text')
  templateName!: string;

  @Column('integer')
  templateVersion!: number;

  @Column('text')
  body!: string;

  @Column('text')
  status!: 'QUEUED' | 'SENT' | 'FAILED' | 'DEAD_LETTERED';

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('deliveries')
@Index('deliveries_message_idx', ['messageId', 'attemptedAt'])
export class NotificationDeliveryEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  messageId!: string;

  @Column('integer')
  attempt!: number;

  @Column('text', { nullable: true })
  providerRef!: string | null;

  @Column('text', { nullable: true })
  trackingId!: string | null;

  @Column('integer', { nullable: true })
  segments!: number | null;

  @Column('text', { nullable: true })
  dlrName!: string | null;

  @Column('integer', { nullable: true })
  carrierPolicy!: number | null;

  @Column('boolean')
  delivered!: boolean;

  @Column('boolean')
  terminal!: boolean;

  @Column('text', { nullable: true })
  error!: string | null;

  @CreateDateColumn()
  attemptedAt!: Date;
}
