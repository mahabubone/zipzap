import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * The membership: one person, one business, one role.
 *
 * `role` is here and not on the user because a role per user cannot express "operator at store A,
 * owner at store B" — which is the ordinary case for anyone running more than one shop.
 *
 * `merchantId` is a bare uuid with a CHECK on `role`, NOT a foreign key: `merchant` is another
 * module's table and a cross-schema FK is exactly the coupling ADR-0002 exists to prevent.
 */
@Entity('user_merchants')
export class UserMerchantEntity {
  @PrimaryColumn('uuid')
  userId!: string;

  @PrimaryColumn('uuid')
  merchantId!: string;

  @Column({ type: 'text', default: 'MERCHANT_OPERATOR' })
  role!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
