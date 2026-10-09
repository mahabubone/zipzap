import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * A person. Not a tenant.
 *
 * The password hash lives here rather than on `merchant.merchants` because a credential belongs to
 * whoever holds it, and one person may hold it for several businesses. That distinction is the
 * whole reason this table exists.
 */
@Entity('users')
export class UserEntity {
  @PrimaryColumn('uuid')
  id!: string;

  /** Lower-cased. Unique, so two people cannot collapse into one login. */
  @Column('text', { unique: true })
  email!: string;

  /** scrypt, versioned — see common/secret.ts. Never reversible, never logged. */
  @Column('text')
  passwordHash!: string;

  @Column('text', { nullable: true })
  displayName!: string | null;

  /**
   * A person disabled outright, across every business. Deliberately distinct from
   * `merchant.merchants.status`: suspending one merchant must not lock a person out of the others.
   */
  @Column({ type: 'timestamptz', nullable: true })
  disabledAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
