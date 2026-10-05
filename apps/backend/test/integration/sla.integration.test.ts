/**
 * Integration: SLA estimation against the real DB — Asia/Dhaka cutoffs, a holiday calendar,
 * and business-day counting. The pure rules are unit-tested; here we prove the wire path:
 * coverage row (estimated_days) -> per-zone cutoffs -> holiday calendar -> estimate.
 *
 * Bangladesh workweek: Sunday-Thursday. Holidays and cutoffs come from `network` tables —
 * never a hardcoded city check.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { DataSource } from 'typeorm';
import { NetworkService } from '../../dist/modules/network/network.service.js';
import { connectModuleDataSource } from '../../dist/database/module-connection.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

let network: NetworkService;
let ds: DataSource;

before(async () => {
  if (!databaseUrl) return;
  ds = await connectModuleDataSource('network', []);
  network = new NetworkService(ds);

  // A mid-week holiday so the estimate can shift over it, plus a second one on a
  // Thursday so the counting loop can be shown to skip it as well.
  await ds.query(
    `INSERT INTO network.holidays (date, reason)
     VALUES ('2026-10-07', 'Eid observation'),
            ('2026-10-16', 'Eid-ul-Adha observation'),
            ('2026-10-22', 'Test holiday (Thursday)')
     ON CONFLICT (date) DO NOTHING`,
  );
});

after(async () => {
  await ds?.destroy();
});

// A UTC Date whose Asia/Dhaka wall-clock time is `hh:mm` on the given date
// (Dhaka is UTC+6).
function dhaka(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, m - 1, d, hh - 6, mm));
}

describeIfDb('SLA — timezone- and holiday-aware', () => {
  test('before the 18:00 pickup cutoff, same-day dispatch estimates +1 business day', async () => {
    // Mon 2026-10-05 10:00 Dhaka; dhaka-metro has estimated_days = 1.
    const now = dhaka(2026, 10, 5, 10, 0);
    const est = await network.estimateDelivery('dhaka-metro', now);
    assert.equal(est.estimatedDate, '2026-10-06');
    assert.equal(est.pickupShifted, false);
    assert.equal(est.skippedHolidays.length, 0);
    assert.equal(est.businessDaysInFlight, 1);
  });

  test('past the pickup cutoff slides dispatch to the next business day', async () => {
    // Mon 19:00 > 18:00 -> dispatch slides from Mon to Tue; Wed 2026-10-07 is a holiday,
    // so the counted day rolls over it to Thu 10-08. estimated = 2026-10-08, shifted.
    const now = dhaka(2026, 10, 5, 19, 0);
    const est = await network.estimateDelivery('dhaka-metro', now);
    assert.equal(est.estimatedDate, '2026-10-08');
    assert.equal(est.pickupShifted, true);
    assert.equal(est.skippedHolidays[0], 'Eid observation');
  });

  test('holidays inside the counting window are skipped', async () => {
    // Tue 10-06 10:00, dhaka-metro has estimated_days = 1: dispatch Tue;
    // +1 business day -> Wed 10-07 is a holiday, so it rolls over to Thu 10-08.
    const now = dhaka(2026, 10, 6, 10, 0);
    const est = await network.estimateDelivery('dhaka-metro', now);
    assert.equal(est.estimatedDate, '2026-10-08');
    assert.equal(est.pickupShifted, false);
    assert.equal(est.skippedHolidays[0], 'Eid observation');
    assert.equal(est.businessDaysInFlight, 1);
  });

  test('an unserviceable zone errors', async () => {
    await assert.rejects(
      async () => await network.estimateDelivery('nonexistent-zone', new Date()),
      /not serviceable|No coverage/,
    );
  });

  test('cutoffs are per-zone; zones without a row use the global default', async () => {
    // sylhet-metro has no cutoff row -> global default 18:00; Mon 19:00 shifts dispatch.
    const now = dhaka(2026, 10, 5, 19, 0);
    const est = await network.estimateDelivery('sylhet-metro', now);
    assert.equal(est.pickupShifted, true);
    // dispatch = nextWorkDay(Tue 10-06) = Tue; +3 business days:
    // Wed(holiday)->Thu 10-08; Fri->Sat->Sun 10-11; Mon 10-12 -> est = 2026-10-12.
    assert.equal(est.estimatedDate, '2026-10-12');
    assert.equal(est.businessDaysInFlight, 3);
  });

  test('a Thursday holiday is skipped in the counting window', async () => {
    // Wed 10-21 10:00, estimated_days = 1: dispatch Wed;
    // +1 -> Thu 10-22 is the test holiday (skipped) -> Fri, Sat non-workdays -> Sun 10-25.
    const now = dhaka(2026, 10, 21, 10, 0);
    const est = await network.estimateDelivery('dhaka-metro', now);
    assert.equal(est.estimatedDate, '2026-10-25');
    assert.ok(est.skippedHolidays.includes('Test holiday (Thursday)'));
    assert.equal(est.pickupShifted, false);
    assert.equal(est.businessDaysInFlight, 1);
  });
});
