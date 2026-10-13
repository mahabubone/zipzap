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

  /**
   * The pricing plan this merchant is on. Decides the `plan_discount_bps` applied to every quote.
   *
   * Server-side, never request-side: `POST /v1/pricing/quote` used to accept `merchantPlan` in the
   * body, which let any caller name the plan with the best discount. See migration 1759000000039.
   */
  @Column('text', { default: 'standard' })
  plan!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
