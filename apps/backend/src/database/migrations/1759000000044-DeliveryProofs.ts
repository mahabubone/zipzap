import type { MigrationInterface, QueryRunner } from 'typeorm';
import { MAX_OTP_ATTEMPTS, MAX_PHOTO_BYTES } from '../../modules/delivery/rules/proof.ts';

/**
 * `delivery.delivery_proofs` — the evidence a delivery claim rests on.
 *
 * One row per delivery job, carrying the whole lifecycle in two states:
 *
 * - `PENDING` — an OTP has been issued and not yet redeemed. Mutable, because a challenge has a
 *   live attempt counter and a live expiry; this is session state, not history.
 * - `VERIFIED` — the recipient read the code out, the photo was fingerprinted, the coordinates
 *   were checked. Immutable from that instant by trigger, because this is history.
 *
 * One table rather than `proof_codes` + `delivery_proofs`: a challenge and its redemption are the
 * same fact at two moments, and splitting them would mean a reissue leaving a stale challenge row
 * that something could still read. Reissue UPDATEs the hash, so the old code stops existing the
 * moment the new one is written.
 *
 * The bytes live here, in Postgres, rather than in a bucket. That is the honest choice at this size
 * (2 MB, one per delivery) because it makes "the photo we showed the merchant" and "the photo the
 * rider submitted" the same row — there is no second store to fall out of sync, and no orphaned
 * object to reconcile.
 * ponytail: when deliveries reach a volume where 2 MB rows hurt, move `photo_data` to MinIO and keep
 * `photo_sha256` as the link. The digest column already exists for exactly that; the upgrade is one
 * repository method and one column dropped.
 *
 * `attempts_used` may reset to 0 on a PENDING -> PENDING reissue, and that is not a hole: a reissue
 * also replaces `code_hash`, so the budget is spent per *code*, not per job. Grinding the budget down
 * costs one SMS per five guesses, paid by the merchant — a far worse attack than the one it prevents.
 */
export class DeliveryProofs1759000000044 implements MigrationInterface {
  name = 'DeliveryProofs1759000000044';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TYPE delivery.proof_status AS ENUM ('PENDING', 'VERIFIED')`);

    await r.query(`
      CREATE TABLE delivery.delivery_proofs (
        id                 uuid        PRIMARY KEY,
        job_id             uuid        NOT NULL,
        code_hash          text        NOT NULL,
        code_salt          text        NOT NULL,
        code_issued_at     timestamptz NOT NULL,
        code_expires_at    timestamptz NOT NULL,
        attempts_used      integer     NOT NULL DEFAULT 0,
        status             delivery.proof_status NOT NULL DEFAULT 'PENDING',
        otp_verified_at    timestamptz,
        photo_sha256       text,
        photo_content_type text,
        photo_byte_length  integer,
        photo_data         bytea,
        latitude           double precision,
        longitude          double precision,
        actor_id           uuid,
        created_at         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT delivery_proofs_attempts_bounded
          CHECK (attempts_used >= 0 AND attempts_used <= ${MAX_OTP_ATTEMPTS}),
        CONSTRAINT delivery_proofs_photo_size
          CHECK (photo_byte_length IS NULL OR photo_byte_length BETWEEN 1 AND ${MAX_PHOTO_BYTES}),
        -- The rule, in the database rather than in a service: a VERIFIED row that is missing any
        -- piece of evidence is not a weaker proof, it is a lie the schema refuses to store.
        CONSTRAINT delivery_proofs_verified_is_complete CHECK (
          status <> 'VERIFIED'
          OR (otp_verified_at IS NOT NULL
              AND photo_sha256 IS NOT NULL
              AND photo_data IS NOT NULL
              AND latitude IS NOT NULL
              AND longitude IS NOT NULL)
        )
      )
    `);
    await r.query(
      `CREATE UNIQUE INDEX delivery_proofs_job_idx ON delivery.delivery_proofs (job_id)`,
    );

    await r.query(`
      CREATE OR REPLACE FUNCTION delivery.delivery_proofs_guard()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION
            'delivery.delivery_proofs cannot be deleted. A delivery claim is not retractable; a wrong proof is answered with a new delivery, not an erasure.'
            USING ERRCODE = 'restrict_violation';
        END IF;

        IF OLD.status = 'VERIFIED' THEN
          RAISE EXCEPTION
            'A verified proof of delivery is immutable. It is the record a dispute is answered from.'
            USING ERRCODE = 'restrict_violation';
        END IF;

        -- Evidence belongs to the redemption, not to a challenge. Writing a photo or a verification
        -- timestamp on a row that is still PENDING would let a partial proof sit in the table looking
        -- like a finished one.
        IF NEW.status = 'PENDING' AND (
             NEW.otp_verified_at IS NOT NULL
          OR NEW.photo_sha256 IS NOT NULL
          OR NEW.photo_data IS NOT NULL
        ) THEN
          RAISE EXCEPTION
            'Proof evidence can only be written by the PENDING -> VERIFIED transition.'
            USING ERRCODE = 'restrict_violation';
        END IF;

        -- Lowering the attempt budget without replacing the code is a free reset, which is the one
        -- thing the budget is for. Raising it is just a wrong guess, so the test is the direction
        -- of the change and not merely that the row is still PENDING.
        IF NEW.attempts_used < OLD.attempts_used AND NEW.code_hash = OLD.code_hash THEN
          RAISE EXCEPTION
            'Resetting the attempt budget requires replacing the delivery code; the previous code must stop existing.'
            USING ERRCODE = 'restrict_violation';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await r.query(`
      CREATE TRIGGER delivery_proofs_no_delete
        BEFORE DELETE ON delivery.delivery_proofs
        FOR EACH ROW EXECUTE FUNCTION delivery.delivery_proofs_guard()
    `);
    await r.query(`
      CREATE TRIGGER delivery_proofs_guard_update
        BEFORE UPDATE ON delivery.delivery_proofs
        FOR EACH ROW EXECUTE FUNCTION delivery.delivery_proofs_guard()
    `);

    await r.query(
      `COMMENT ON TABLE delivery.delivery_proofs IS
       'Proof of delivery: hashed OTP challenge (PENDING) and the recipient-confirmed, photographed, located redemption (VERIFIED). VERIFIED is immutable; deletion is refused outright.'`,
    );
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TABLE IF EXISTS delivery.delivery_proofs CASCADE');
    await r.query('DROP FUNCTION IF EXISTS delivery.delivery_proofs_guard()');
    await r.query('DROP TYPE IF EXISTS delivery.proof_status');
  }
}
