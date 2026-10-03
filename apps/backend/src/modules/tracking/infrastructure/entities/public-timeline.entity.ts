/**
 * The public read model behind /track/:trackingCode.
 *
 * A separate table, not a filtered query over `events`. The dangerous fields are absent here, so
 * there is no query to get wrong and no filter to forget — and the public page gets one narrow
 * index instead of the whole event history.
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import { TRACKING_EVENT_TYPES, type TrackingEventType } from '../../domain/tracking-event.ts';

@Entity('public_timeline')
@Index('public_timeline_code_seq_idx', ['trackingCode', 'sequence'])
export class PublicTimelineEntity {
  @PrimaryColumn('uuid')
  id!: string;

  /** Copied from the shipment at event time — the public page may not read shipment tables. */
  @Index('public_timeline_tracking_code_idx')
  @Column('text')
  trackingCode!: string;

  @Column('uuid')
  shipmentId!: string;

  /** Monotonic per shipment, so the public timeline has a total order. */
  @Column('integer')
  sequence!: number;

  @Column({ type: 'enum', enum: TRACKING_EVENT_TYPES })
  eventType!: TrackingEventType;

  @Column('timestamptz')
  occurredAt!: Date;

  @CreateDateColumn()
  projectedAt!: Date;
}
