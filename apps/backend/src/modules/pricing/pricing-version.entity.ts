/**
 * A frozen pricing version. Rules never change in place — a new version is a new row, and quotes
 * always name the version they were computed against. That is the entire version-freeze guarantee.
 *
 * All minor-unit columns are bigint: money is never a float (ADR-0009).
 */

import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type { Currency } from '../../common/money.ts';

@Entity('versions')
export class PricingVersionEntity {
  @PrimaryColumn('integer')
  version!: number;

  @Column('bigint')
  baseFeeMinor!: number;

  @Column('bigint')
  perKgMinor!: number;

  /** Integer basis points, never a rate. 180 = 1.8%. */
  @Column('integer')
  codFeeBps!: number;

  @Column('bigint')
  remoteAreaFeeMinor!: number;

  @Column('bigint')
  fragileFeeMinor!: number;

  /** kind -> minor units. Merged key-wise by resolveVersion. */
  @Column('jsonb')
  packagingFeesMinor!: Record<string, number>;

  @Column('integer')
  taxBps!: number;

  /** plan -> discount basis points. */
  @Column('jsonb')
  planDiscountBps!: Record<string, number>;

  @Column('char', { length: 3 })
  currency!: Currency;

  @Column('boolean')
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
