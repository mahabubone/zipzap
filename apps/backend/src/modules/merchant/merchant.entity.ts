import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { MERCHANT_STATUSES, type MerchantStatus } from '../../domain/merchant.ts';

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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
