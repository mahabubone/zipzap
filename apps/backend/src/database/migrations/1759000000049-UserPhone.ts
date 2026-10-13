import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `identity.users.phone` — a rider's login handle.
 *
 * The rider app signed riders in with an email address, which is wrong in a way that shows up
 * immediately in the field. A rider in Dhaka is issued a SIM card, not a mailbox: they are given a
 * number at the depot, they do not choose a password they will remember, and their phone is the
 * only identifier that is actually theirs. Asking for an email means every rider either invents one
 * or shares the dispatcher's — and the shared case is a real authentication problem, because two
 * people typing the same credentials is indistinguishable from one person on two devices.
 *
 * So the number becomes the handle, which means it has to be a credential and the credential
 * belongs to `identity`, not to `rider`. A rider therefore has TWO rows and always did:
 * `rider.riders` (the operational record — capacity, position, status) and `identity.users` (the
 * credential). That split is already the model for every other person in the system; this column
 * simply makes it usable for a rider who has no email.
 *
 * Nullable, because most users are merchants and an email is the right handle for them. A rider
 * without a phone cannot sign in, which is correct — a rider with no reachable number is a rider a
 * dispatcher cannot call.
 *
 * UNIQUE and partial (`WHERE phone IS NOT NULL`) rather than a plain UNIQUE, because every
 * merchant user in the system has `phone = NULL` and a plain unique constraint permits exactly one
 * NULL in PostgreSQL. That is the single most common way a nullable-unique migration breaks on
 * table two.
 *
 * Stored E.164-normalised, like `rider.riders.phone`, so `+8801712345678` and `01712345678` cannot
 * become two accounts. The normalisation lives in the rules, not here.
 */
export class UserPhone1759000000049 implements MigrationInterface {
  name = 'UserPhone1759000000049';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS phone text`);
    await r.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique
         ON identity.users (phone) WHERE phone IS NOT NULL`,
    );
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP INDEX IF EXISTS identity.users_phone_unique`);
    await r.query(`ALTER TABLE identity.users DROP COLUMN IF EXISTS phone`);
  }
}
