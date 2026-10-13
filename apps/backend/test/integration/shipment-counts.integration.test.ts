/**
 * Integration: `ShipmentRepository.merchantCounts` against the real DB.
 *
 * This is the read behind the merchant console's landing screen — four numbers a merchant can be
 * shown about their own parcels, and nothing about anybody else's. The screen had been asking the
 * control tower for the network's version of those numbers and getting 403, because that endpoint is
 * `network:read` on purpose. So the aggregate now exists inside the module that owns the table, and
 * the tenancy predicate in it is load-bearing: get it wrong and a merchant is shown every parcel on
 * the network, which is the worst thing a console can do and the kind of mistake that is invisible
 * until it has already shipped.
 *
 * ## Why this suite inserts and deletes its own rows
 *
 * `dashboard.integration.test.ts` empties `shipment.shipments` outright, because it is testing
 * projections and wants a known-empty world. That is right for it and hostile to a demo database:
 * after a run, the fixture the screenshots are built from is gone. This suite therefore isolates
 * itself the other way — two merchants of its own, tracking codes under a per-run prefix, and a
 * `DELETE … WHERE merchant_id = ANY($1)` in `after` that touches nothing but what it created.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { connectModuleDataSource } from '../../dist/database/module-connection.js';
import { ShipmentRepository } from '../../dist/modules/shipment/shipment.repository.js';
import { ShipmentEntity } from '../../dist/modules/shipment/shipment.entity.js';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

/** Unique per run, so two concurrent runs cannot collide on the tracking-code unique index. */
const RUN = randomUUID().slice(0, 8);

/** The merchant whose numbers this suite asserts on. */
const MINE = randomUUID();

/** A stranger, present in the same table, whose parcels must never appear in MINE's counts. */
const THEIRS = randomUUID();

const todayStart = new Date();
todayStart.setHours(0, 0, 0, 0);
const yesterday = new Date(todayStart);
yesterday.setDate(yesterday.getDate() - 1);

let db: DataSource;
let shipments: ShipmentRepository;

/** MINE's parcels: 3 DELIVERED today, 1 IN_TRANSIT today, 1 CREATED yesterday. */
const mine: Array<[string, Date]> = [
  ['DELIVERED', todayStart],
  ['DELIVERED', todayStart],
  ['DELIVERED', todayStart],
  ['IN_TRANSIT', todayStart],
  ['CREATED', yesterday],
];

/** The stranger's: 9 DELIVERED today — more than MINE owns in total, on purpose. */
const theirs: Array<[string, Date]> = Array.from({ length: 9 }, () => ['DELIVERED', todayStart]);

async function insert(
  merchantId: string,
  status: string,
  createdAt: Date,
  tag: string,
): Promise<void> {
  await db.query(
    `INSERT INTO shipment.shipments (id, tracking_code, merchant_id, sender_name, sender_phone,
       sender_address, recipient_name, recipient_phone, recipient_address, parcel_weight_grams,
       parcel_description, cod_amount_minor, cod_currency, status, held_from_status, pricing_version,
       created_at, updated_at)
     VALUES ($1, $2, $3, 'Sender', '+8801700000001', '12 Sender St', 'Recipient', '+8801700000002',
       '12 Recipient Rd', 500, 'a package', '50000', 'BDT', $4, NULL, 1, $5, $5)`,
    [randomUUID(), `MK-${RUN}-${tag}`, merchantId, status, createdAt.toISOString()],
  );
}

before(async () => {
  db = await connectModuleDataSource('shipment', [ShipmentEntity]);
  shipments = new ShipmentRepository();

  let n = 0;
  for (const [status, createdAt] of mine) await insert(MINE, status, createdAt, `m${n++}`);
  n = 0;
  for (const [status, createdAt] of theirs) await insert(THEIRS, status, createdAt, `t${n++}`);
});

after(async () => {
  // `db` is undefined when `before` never connected — no `DATABASE_URL`, say. A cleanup hook that
  // assumes its subject exists turns a skip into a crash, which is how a suite that was never
  // supposed to run starts failing in someone's CI log.
  if (!db) return;

  // Scoped to this suite's two merchants. A bare `DELETE FROM shipment.shipments` here would undo
  // the isolation the whole file is built to preserve.
  await db.query('DELETE FROM shipment.shipments WHERE merchant_id = ANY($1)', [[MINE, THEIRS]]);
  await db.destroy();
});

const countFor = async (merchantId: string) =>
  db.transaction((manager) => shipments.merchantCounts(manager, merchantId));

describeIfDb('ShipmentRepository.merchantCounts', () => {
  test("counts only that merchant's shipments", async () => {
    const { byStatus, total } = await countFor(MINE);

    assert.equal(total, mine.length, "a stranger's 9 delivered parcels must not be counted here");
    assert.equal(byStatus.get('DELIVERED'), 3);
    assert.equal(byStatus.get('IN_TRANSIT'), 1);
    assert.equal(byStatus.get('CREATED'), 1);
  });

  test('the stranger sees their own parcels, and only theirs', async () => {
    // The mirror of the test above, because "scoped correctly" and "returns someone else's rows" are
    // two different mistakes and only the second one is caught by asserting on one side.
    const { byStatus, total } = await countFor(THEIRS);

    assert.equal(total, theirs.length);
    assert.equal(byStatus.get('DELIVERED'), 9);
    assert.equal(byStatus.get('IN_TRANSIT'), undefined);
  });

  test("todayNew counts today, in the merchant's own calendar day", async () => {
    const { todayNew } = await countFor(MINE);

    // 4 of the 5 were created at today's start; the CREATED one is from yesterday, which is the whole
    // reason the figure is computed in the aggregate rather than added up on the client.
    assert.equal(todayNew, 4);
  });

  test('an account with no shipments gets zeroes, not an error', async () => {
    const { byStatus, total, todayNew } = await countFor(randomUUID());

    assert.equal(total, 0);
    assert.equal(todayNew, 0);
    assert.equal(byStatus.size, 0, 'no rows means no map entries; the controller fills the zeros');
  });

  test('the map carries only statuses that exist, so absent keys mean zero', async () => {
    const { byStatus } = await countFor(MINE);

    // The controller's job is to complete this to every status in the machine. It has to be able to
    // tell "no shipments in this state" from "a state that does not exist", and that is only true if
    // the query returns what is there.
    assert.deepEqual([...byStatus.keys()].sort(), ['CREATED', 'DELIVERED', 'IN_TRANSIT']);
  });

  test('a second read agrees with the first', async () => {
    // Counts are read outside a write, so there is no invariant forcing them to be stable — but two
    // consecutive reads on a quiet database must not differ, or the number on a dashboard is noise.
    const first = await countFor(MINE);
    const second = await countFor(MINE);

    assert.deepEqual([...first.byStatus].sort(), [...second.byStatus].sort());
    assert.equal(first.total, second.total);
    assert.equal(first.todayNew, second.todayNew);
  });
});
