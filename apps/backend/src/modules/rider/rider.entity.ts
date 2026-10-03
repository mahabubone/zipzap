/**
 * Rider persistence. Owns schema `rider` only.
 *
 * Holds identifiers for everything it must not read: `currentJobId` is a bare reference to a
 * pickup or delivery record, resolved through that module's contract. See ADR-0002.
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { RIDER_STATUSES, type RiderStatus } from './rules/rider.ts';

@Entity('riders')
@Index('riders_status_updated_idx', ['status', 'updatedAt'])
export class RiderEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('text')
  displayName!: string;

  @Column('text', { unique: true })
  phone!: string;

  @Column({ type: 'enum', enum: RIDER_STATUSES })
  status!: RiderStatus;

  /** Last known position. High-frequency and short-lived — Postgres keeps the latest only. */
  @Column('double precision', { nullable: true })
  lastKnownLatitude!: number | null;

  @Column('double precision', { nullable: true })
  lastKnownLongitude!: number | null;

  @Column('timestamptz', { nullable: true })
  lastKnownAt!: Date | null;

  /** Bare identifier for the active pickup/delivery job, if any. Not a foreign key. */
  @Column('uuid', { nullable: true })
  currentJobId!: string | null;

  @Column('integer')
  capacity!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
