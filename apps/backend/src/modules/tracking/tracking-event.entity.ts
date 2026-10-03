/**
 * The append-only tracking log. Immutability is enforced by a database trigger, not by review —
 * see migration CreateTrackingTables.
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import { TRACKING_EVENT_TYPES, type TrackingEventType } from './rules/tracking-event.ts';

@Entity('events')
@Index('events_shipment_occurred_idx', ['shipmentId', 'occurredAt'])
export class TrackingEventEntity {
  @PrimaryColumn('uuid')
  id!: string;

  /** An identifier, not a foreign key. See ADR-0002. */
  @Column('uuid')
  shipmentId!: string;

  @Column({ type: 'enum', enum: TRACKING_EVENT_TYPES })
  eventType!: TrackingEventType;

  /** The device that recorded it. Distinct from recordedAt, which is when we learned of it. */
  @Column('timestamptz')
  occurredAt!: Date;

  @CreateDateColumn()
  recordedAt!: Date;

  @Column('text')
  actorType!: string;

  @Column('uuid', { nullable: true })
  actorId!: string | null;

  @Column('jsonb')
  metadata!: Record<string, unknown>;

  @Column('uuid', { nullable: true })
  correctsEventId!: string | null;
}
