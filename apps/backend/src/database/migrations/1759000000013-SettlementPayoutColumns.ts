/**
 * finance.settlements gains its payout columns.
 *
 * APPROVED -> PAYMENT_INITIATED calls the provider; PAYMENT_INITIATED ->
 * PAYMENT_CONFIRMED records the provider's answer. Both need somewhere to live:
 *
 *  - payment_reference  the provider's id for this payout (mock: MOCK000001).
 *  - payment_initiated_at / payment_confirmed_at  when each leg happened.
 *
 * Nullable because CREATED and APPROVED rows predate any provider contact. The
 * invoice number is NOT stored: it is derived deterministically from the settlement
 * reference (`PAY-<reference>`), so a retry re-derives the same invoice and the
 * provider converges instead of double-paying. Storing it would create a second
 * source of truth for a value that is a pure function of the row.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SettlementPayoutColumns1759000000013 implements MigrationInterface {
  name = 'SettlementPayoutColumns1759000000013';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`
      ALTER TABLE finance.settlements
        ADD COLUMN payment_reference text,
        ADD COLUMN payment_initiated_at timestamptz,
        ADD COLUMN payment_confirmed_at timestamptz
    `);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`
      ALTER TABLE finance.settlements
        DROP COLUMN payment_confirmed_at,
        DROP COLUMN payment_initiated_at,
        DROP COLUMN payment_reference
    `);
  }
}
