/**
 * Proof-of-delivery persistence. Owns schema `delivery` only.
 *
 * `jobId` is a bare identifier, not a foreign key — rule 2. No `shipmentId`: the proof answers "did
 * the recipient get it", and the job already knows which parcel it carries.
 */

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('delivery_proofs')
@Index('delivery_proofs_job_idx', ['jobId'], { unique: true })
export class DeliveryProofEntity {
  @PrimaryColumn('uuid')
  id!: string;

  /** One proof per delivery job. The unique index is what makes that true under concurrency. */
  @Column('uuid')
  jobId!: string;

  /** SHA-256 of `salt:code`. Never the code: a dump of this table must not hand over live OTPs. */
  @Column('text')
  codeHash!: string;

  @Column('text')
  codeSalt!: string;

  @Column('timestamptz')
  codeIssuedAt!: Date;

  @Column('timestamptz')
  codeExpiresAt!: Date;

  @Column('integer')
  attemptsUsed!: number;

  @Column({ type: 'enum', enum: ['PENDING', 'VERIFIED'] })
  status!: 'PENDING' | 'VERIFIED';

  @Column('timestamptz', { nullable: true })
  otpVerifiedAt!: Date | null;

  /** The fingerprint. Once this is recorded it is what "the photo" means for the rest of the row's life. */
  @Column('text', { nullable: true })
  photoSha256!: string | null;

  @Column('text', { nullable: true })
  photoContentType!: string | null;

  @Column('integer', { nullable: true })
  photoByteLength!: number | null;

  /** Raw bytes, capped at MAX_PHOTO_BYTES by the rule and by the CHECK constraint alike. */
  @Column('bytea', { nullable: true, select: false })
  photoData!: Buffer | null;

  @Column('double precision', { nullable: true })
  latitude!: number | null;

  @Column('double precision', { nullable: true })
  longitude!: number | null;

  /** The rider who captured it. Bare identifier, same as every other actor column in the system. */
  @Column('uuid', { nullable: true })
  actorId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
