/**
 * Holiday calendar + per-zone pickup/delivery cutoffs (Phase 5 rung 3: SLA).
 *
 * The holiday calendar makes the SLA skip non-working days that are not weekends. Cutoffs make
 * the estimate timezone-aware in Asia/Dhaka: a request submitted after the pickup cutoff rolls
 * to the next business day's dispatch instead of shipping today.
 *
 * Columns are typed as `time` (no timezone): they are always interpreted as Asia/Dhaka wall
 * clock time, which is what a merchant in Dhaka actually sees. The rule defaults to 18:00
 * pickup / 20:00 delivery when no zone row exists.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

const HOLIDAYS = [
  { date: '2026-01-01', reason: "New Year's Day" },
  { date: '2026-02-21', reason: 'Ekushey February (Language Martyrs Day)' },
  { date: '2026-03-26', reason: 'Independence Day' },
  { date: '2026-05-01', reason: 'International Labour Day' },
  { date: '2026-08-15', reason: 'Independence Day (Bangladesh)' },
  { date: '2026-12-16', reason: 'Victory Day' },
];

export class HolidayCalendarAndCutoffs1759000000027 implements MigrationInterface {
  name = 'HolidayCalendarAndCutoffs1759000000027';

  public async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE network.zone_cutoffs (
        zone             text        PRIMARY KEY REFERENCES network.service_areas(zone) ON DELETE CASCADE,
        pickup_cutoff    time        NOT NULL DEFAULT '18:00',
        delivery_cutoff  time        NOT NULL DEFAULT '20:00',
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now()
      )
    `);

    await r.query(`
      CREATE TABLE network.holidays (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        date       date        NOT NULL,
        reason     text        NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await r.query(`CREATE UNIQUE INDEX holidays_date_uq ON network.holidays(date)`);

    for (const h of HOLIDAYS) {
      await r.query(`INSERT INTO network.holidays (date, reason) VALUES ($1, $2)`, [
        h.date,
        h.reason,
      ]);
    }

    // Seed Dhaka-metro explicitly; the FK ties cutoffs to coverage zones, and only
    // dhaka-metro exists in the seed coverage data (other zones keep the global default).
    await r.query(`INSERT INTO network.zone_cutoffs (zone, pickup_cutoff, delivery_cutoff)
                   VALUES ('dhaka-metro', '18:00', '20:00')`);
  }

  public async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE IF EXISTS network.holidays`);
    await r.query(`DROP TABLE IF EXISTS network.zone_cutoffs`);
  }
}
