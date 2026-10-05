/**
 * Coverage row: one zone, five flags. Own schema `network`.
 *
 * The row IS the serviceability policy (docs/domains/network.md "Coverage is
 * data"). Zone is the natural key — one row per zone, upsert-able by name.
 */

import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('service_areas')
export class ServiceAreaEntity {
  @PrimaryColumn('text')
  zone!: string;

  @Column('boolean')
  serviceable!: boolean;

  @Column('integer', { nullable: true })
  estimatedDays!: number | null;

  @Column('boolean')
  pickupAvailable!: boolean;

  @Column('boolean')
  deliveryAvailable!: boolean;

  @Column('boolean')
  codAvailable!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
