import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { MERCHANT_STATUSES, type MerchantStatus } from './rules/merchant.ts';

@Entity('merchants')
export class MerchantEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('text')
  name!: string;

  @Column({ type: 'enum', enum: MERCHANT_STATUSES })
  status!: MerchantStatus;

  @Column('text', { unique: true })
  contactEmail!: string;

  /**
   * Per-contract rate limit, requests per minute. NULL = tier default.
   * Configuration, not history — see migration 0022.
   */
  @Column('integer', { nullable: true })
  rateLimitPerMin!: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
