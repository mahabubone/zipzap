/**
 * Integration: control-tower live counts against the real DB.
 *
 * Phase 6 rung 1 — the dashboard reads live counts from every domain module through that
 * module's own connection and reports one snapshot. This proves the cross-module read
 * surface returns correct numbers over the live `shipment`, `pickup`, `delivery`, `cod`,
 * `rider` and `hub` tables, and that the numbers update as the network moves.
 *
 * We do not spin up Nest here — DashboardService is constructed directly from DataSources
 * and repositories the same way the flagship integration tests do. It is the HTTP endpoint
 * that is exercised by openapi-contract.integration.test.ts.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { connectModuleDataSource } from '../../dist/database/module-connection.js';
import { DashboardService } from '../../dist/modules/dashboard/dashboard.service.js';
import { ShipmentRepository } from '../../dist/modules/shipment/shipment.repository.js';
import { PickupRepository } from '../../dist/modules/pickup/pickup.repository.js';
import { DeliveryRepository } from '../../dist/modules/delivery/delivery.repository.js';
import { CodRecordRepository } from '../../dist/modules/cod/cod-record.repository.js';
import { RiderRepository } from '../../dist/modules/rider/rider.repository.js';
import { HubRepository } from '../../dist/modules/hub/hub.repository.js';
import { RiderEntity } from '../../dist/modules/rider/rider.entity.js';
import { ShipmentEntity } from '../../dist/modules/shipment/shipment.entity.js';
import { PickupEntity } from '../../dist/modules/pickup/pickup.entity.js';
import { DeliveryJobEntity } from '../../dist/modules/delivery/delivery.entity.js';
import { CodRecordEntity } from '../../dist/modules/cod/cod-record.entity.js';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

// Unique prefix so this run's riders never collide with other suites or prior runs on
// the shared live DB. Sequential concurrency makes the clears safe.
const POOL_PREFIX = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');

const todayStart = new Date();
todayStart.setHours(0, 0, 0, 0);
const yesterday = new Date(todayStart);
yesterday.setDate(yesterday.getDate() - 1);

let shipmentDb: DataSource;
let pickupDb: DataSource;
let deliveryDb: DataSource;
let codDb: DataSource;
let riderDb: DataSource;
let hubDb: DataSource;

let shipments: ShipmentRepository;
let pickups: PickupRepository;
let deliveries: DeliveryRepository;
let cod: CodRecordRepository;
let riders: RiderRepository;
let hub: HubRepository;
let service: DashboardService;
let shipmentIds: string[] = [];

before(async () => {
  shipmentDb = await connectModuleDataSource('shipment', [ShipmentEntity]);
  pickupDb = await connectModuleDataSource('pickup', [PickupEntity]);
  deliveryDb = await connectModuleDataSource('delivery', [DeliveryJobEntity]);
  codDb = await connectModuleDataSource('cod', [CodRecordEntity]);
  riderDb = await connectModuleDataSource('rider', [RiderEntity]);
  hubDb = await connectModuleDataSource('hub', []);

  shipments = new ShipmentRepository();
  pickups = new PickupRepository();
  deliveries = new DeliveryRepository();
  cod = new CodRecordRepository();
  riders = new RiderRepository();
  hub = new HubRepository();
  service = new DashboardService(
    shipmentDb,
    pickupDb,
    deliveryDb,
    codDb,
    riderDb,
    hubDb,
    shipments,
    pickups,
    deliveries,
    cod,
    riders,
    hub,
  );

  // Isolate this suite on the shared live DB.
  await riderDb.query('DELETE FROM rider.riders');
  await codDb.query('DELETE FROM cod.records');
  await deliveryDb.query('DELETE FROM delivery.attempts');
  await deliveryDb.query('DELETE FROM delivery.jobs');
  await pickupDb.query('DELETE FROM pickup.pickups');
  await shipmentDb.query('DELETE FROM shipment.shipments');

  const m = shipmentDb.manager;
  // Shipments: 9 total, 8 created today (1 created yesterday to test todayNew).
  const s1 = randomUUID(); // DELIVERED — today
  const s2 = randomUUID(); // DELIVERED — yesterday
  const s3 = randomUUID(); // IN_TRANSIT
  const s4 = randomUUID(); // OUT_FOR_DELIVERY
  const s5 = randomUUID(); // CREATED — today
  const s6 = randomUUID(); // RETURNED
  const s7 = randomUUID(); // CANCELLED
  const s8 = randomUUID(); // ON_HOLD
  const s9 = randomUUID(); // DELIVERY_FAILED
  shipmentIds = [s1, s2, s3, s4, s5, s6, s7, s8, s9];

  const createShipment = async (id: string, status: string, createdAt: Date) =>
    m.query(
      `INSERT INTO shipment.shipments (id, tracking_code, merchant_id, sender_name, sender_phone,
        sender_address, recipient_name, recipient_phone, recipient_address, parcel_weight_grams,
        parcel_description, cod_amount_minor, cod_currency, status, held_from_status, pricing_version,
        created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        id,
        `TRK-${id.slice(0, 8)}`,
        randomUUID(),
        'Sender Name',
        '+8801700000001',
        '12 Sender St',
        'Recipient Name',
        '+8801700000002',
        '12 Recipient Rd',
        500,
        'a package',
        '50000',
        'BDT',
        status,
        null,
        1,
        createdAt.toISOString(),
        createdAt.toISOString(),
      ],
    );

  await Promise.all([
    createShipment(s1, 'DELIVERED', todayStart),
    createShipment(s2, 'DELIVERED', yesterday),
    createShipment(s3, 'IN_TRANSIT', todayStart),
    createShipment(s4, 'OUT_FOR_DELIVERY', todayStart),
    createShipment(s5, 'CREATED', todayStart),
    createShipment(s6, 'RETURNED', todayStart),
    createShipment(s7, 'CANCELLED', todayStart),
    createShipment(s8, 'ON_HOLD', todayStart),
    createShipment(s9, 'DELIVERY_FAILED', todayStart),
  ]);

  // Pickups: 5 total — 2 active (ASSIGNED, IN_PROGRESS), 1 completed, 1 failed, 1 cancelled.
  const p1 = randomUUID();
  const p2 = randomUUID();
  const p3 = randomUUID();
  const p4 = randomUUID();
  const p5 = randomUUID();
  const createPickup = async (
    id: string,
    status: string,
    failureReason: string | null,
    shipList: readonly string[],
  ) =>
    pickupDb.query(
      `INSERT INTO pickup.pickups (id, merchant_id, shipment_ids, rider_id, status, failure_reason,
        total_weight_grams, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        randomUUID(),
        shipList,
        randomUUID(),
        status,
        failureReason,
        500,
        todayStart.toISOString(),
        todayStart.toISOString(),
      ],
    );
  await Promise.all([
    createPickup(p1, 'ASSIGNED', null, [s1]),
    createPickup(p2, 'IN_PROGRESS', null, [s3]),
    createPickup(p3, 'COMPLETED', null, [s2]),
    createPickup(p4, 'FAILED', 'CUSTOMER_UNAVAILABLE', [s5]),
    createPickup(p5, 'CANCELLED', null, [s6]),
  ]);

  // Deliveries: 2 total — 1 out for delivery, 1 attempted with retry budget.
  const d1 = randomUUID();
  const d2 = randomUUID();
  const createDelivery = async (id: string, status: string, attemptsMade: number, ship: string) =>
    deliveryDb.query(
      `INSERT INTO delivery.jobs (id, shipment_id, rider_id, status, attempts_made, last_failure_reason,
        created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        ship,
        randomUUID(),
        status,
        attemptsMade,
        null,
        todayStart.toISOString(),
        todayStart.toISOString(),
      ],
    );
  await Promise.all([
    createDelivery(d1, 'OUT_FOR_DELIVERY', 0, s4),
    createDelivery(d2, 'ATTEMPTED', 1, s5),
  ]);

  // COD records: 2 total — both collected but not yet settled (outstanding).
  const c1 = randomUUID();
  const c2 = randomUUID();
  const createCod = async (id: string, expected: string, collected: string, status: string) =>
    codDb.query(
      `INSERT INTO cod.records (id, shipment_id, merchant_id, expected_minor, collected_minor,
        currency, status, failure_note, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        status === 'COD_RECONCILED' ? s3 : s1,
        randomUUID(),
        expected,
        collected,
        'BDT',
        status,
        null,
        todayStart.toISOString(),
        todayStart.toISOString(),
      ],
    );
  await Promise.all([
    createCod(c1, '50000', '25000', 'COD_COLLECTED'),
    createCod(c2, '75050', '75050', 'COD_RECONCILED'),
  ]);

  // Riders: 3 total — 1 available, 1 on delivery (online), 1 offline.
  const createRider = async (phone: string, status: string, capacity: number) =>
    riderDb.query(
      `INSERT INTO rider.riders (id, display_name, phone, status, last_known_latitude,
        last_known_longitude, last_known_at, current_job_id, capacity, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        randomUUID(),
        `Rider ${status.toLowerCase()}`,
        phone,
        status,
        23.81,
        90.41,
        null,
        null,
        capacity,
        todayStart.toISOString(),
        todayStart.toISOString(),
      ],
    );
  await Promise.all([
    createRider(`+88017${POOL_PREFIX}001`, 'AVAILABLE', 3),
    createRider(`+88017${POOL_PREFIX}002`, 'ON_DELIVERY', 2),
    createRider(`+88017${POOL_PREFIX}003`, 'OFFLINE', 3),
  ]);
});

after(async () => {
  await riderDb.query('DELETE FROM rider.riders');
  await codDb.query('DELETE FROM cod.records');
  await deliveryDb.query('DELETE FROM delivery.attempts');
  await deliveryDb.query('DELETE FROM delivery.jobs');
  await pickupDb.query('DELETE FROM pickup.pickups');
  await shipmentDb.query('DELETE FROM shipment.shipments');
  await Promise.all([
    shipmentDb.destroy(),
    pickupDb.destroy(),
    deliveryDb.destroy(),
    codDb.destroy(),
    riderDb.destroy(),
    hubDb.destroy(),
  ]);
});

describeIfDb('dashboard live counts', () => {
  test('returns counts matching the seeded data', async () => {
    const counts = await service.getLiveCounts();

    // Timestamp is a single ISO instant for the whole snapshot.
    assert.match(counts.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // Shipments: 9 total, 8 created today (one seeded yesterday).
    assert.equal(counts.shipments.total, 9);
    assert.equal(counts.shipments.todayNew, 8);
    assert.equal(counts.shipments.inTransit, 1); // IN_TRANSIT
    assert.equal(counts.shipments.atHub, 0);
    assert.equal(counts.shipments.sorting, 0);
    assert.equal(counts.shipments.outForDelivery, 1); // OUT_FOR_DELIVERY
    assert.equal(counts.shipments.delivered, 2); // DELIVERED (today + yesterday)
    assert.equal(counts.shipments.failed, 1); // DELIVERY_FAILED
    assert.equal(counts.shipments.returned, 1); // RETURNED
    assert.equal(counts.shipments.returning, 1); // RETURNED counts in the return lifecycle
    assert.equal(counts.shipments.cancelled, 1);
    assert.equal(counts.shipments.onHold, 1);
    assert.equal(counts.shipments.lostOrDamaged, 0);
    assert.equal(counts.shipments.exception, 0);
    // byStatus is complete: every enum status present.
    const sMap = counts.shipments.byStatus as Record<string, number>;
    assert.equal(sMap.DELIVERED, 2);
    assert.equal(sMap.IN_TRANSIT, 1);
    assert.equal(sMap.OUT_FOR_DELIVERY, 1);
    assert.equal(sMap.CREATED, 1);
    assert.equal(sMap.RETURNED, 1);
    assert.equal(sMap.CANCELLED, 1);
    assert.equal(sMap.ON_HOLD, 1);
    assert.equal(sMap.DELIVERY_FAILED, 1);
    for (const [status, count] of Object.entries(sMap)) {
      assert.ok(typeof count === 'number', `status ${status} has numeric count`);
    }

    // Pickups: 5 total, 2 active.
    assert.equal(counts.pickups.total, 5);
    assert.equal(counts.pickups.active, 2); // ASSIGNED + IN_PROGRESS
    assert.equal(counts.pickups.pending, 0);
    assert.equal(counts.pickups.completed, 1);
    assert.equal(counts.pickups.failed, 1);
    assert.equal(counts.pickups.expired, 0);
    assert.equal(counts.pickups.cancelled, 1);

    // Deliveries: 2 total.
    assert.equal(counts.deliveries.total, 2);
    assert.equal(counts.deliveries.outForDelivery, 1);
    assert.equal(counts.deliveries.attempted, 1);
    assert.equal(counts.deliveries.attemptsRemaining, 1); // ATTEMPTED with attemptsMade < 3
    assert.equal(counts.deliveries.failed, 0);
    assert.equal(counts.deliveries.delivered, 0);

    // COD: 2 total, both outstanding (collected but not settled).
    assert.equal(counts.cod.total, 2);
    assert.equal(counts.cod.expected, 0);
    assert.equal(counts.cod.outstanding, 2);
    assert.equal(counts.cod.outstandingAmountMinor, BigInt(125050));

    // Riders: 3 total, 2 online (AVAILABLE + ON_DELIVERY).
    assert.equal(counts.riders.total, 3);
    assert.equal(counts.riders.online, 2);
    assert.equal(counts.riders.available, 1);
    assert.equal(counts.riders.offline, 1);
    assert.equal(counts.riders.suspended, 0);

    // Hubs: migration 0025 seeds 6; load profiles top the network up
    // (docs/testing/fixtures.md), so the floor is the invariant, not the total.
    assert.ok(counts.hub.networkHubs >= 6, `expected >= 6 hubs, got ${counts.hub.networkHubs}`);
    assert.equal(counts.hub.backlog, 0);
  });

  test('a new delivered shipment increments the delivered count', async () => {
    const sBefore = (await service.getLiveCounts()).shipments;
    assert.equal(sBefore.delivered, 2);

    const sNew = randomUUID();
    await shipmentDb.query(
      `INSERT INTO shipment.shipments (id, tracking_code, merchant_id, sender_name, sender_phone,
        sender_address, recipient_name, recipient_phone, recipient_address, parcel_weight_grams,
        parcel_description, cod_amount_minor, cod_currency, status, held_from_status, pricing_version,
        created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        sNew,
        `TRK-${sNew.slice(0, 8)}`,
        randomUUID(),
        'New Sender',
        '+8801700000001',
        '12 Sender St',
        'New Recipient',
        '+8801700000002',
        '12 Recipient Rd',
        500,
        'a package',
        '50000',
        'BDT',
        'DELIVERED',
        null,
        1,
        todayStart.toISOString(),
        todayStart.toISOString(),
      ],
    );

    const counts = await service.getLiveCounts();
    assert.equal(counts.shipments.delivered, 3);
    assert.equal(counts.shipments.total, 10);
    assert.equal(counts.shipments.todayNew, 9);
    // A fresh snapshot still carries one single timestamp.
    assert.match(counts.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('hub backlog counts shipments at a hub or sorting', async () => {
    const before = await service.getLiveCounts();
    assert.equal(before.hub.backlog, 0);
    assert.equal(before.shipments.atHub, 0);
    assert.equal(before.shipments.sorting, 0);

    // Move one existing shipment to AT_ORIGIN_HUB and one to SORTING.
    await shipmentDb.query(
      `UPDATE shipment.shipments SET status = 'AT_ORIGIN_HUB' WHERE id = $1`,
      [shipmentIds[2]], // s3 was IN_TRANSIT
    );
    await shipmentDb.query(
      `UPDATE shipment.shipments SET status = 'SORTING' WHERE id = $1`,
      [shipmentIds[3]], // s4 was OUT_FOR_DELIVERY
    );

    const counts = await service.getLiveCounts();
    assert.equal(counts.hub.backlog, 2);
    assert.equal(counts.shipments.atHub, 1);
    assert.equal(counts.shipments.sorting, 1);
    assert.equal(counts.shipments.inTransit, 0);
    assert.equal(counts.shipments.outForDelivery, 0);

    // Clean up: restore original statuses.
    await shipmentDb.query(`UPDATE shipment.shipments SET status = 'IN_TRANSIT' WHERE id = $1`, [
      shipmentIds[2],
    ]);
    await shipmentDb.query(
      `UPDATE shipment.shipments SET status = 'OUT_FOR_DELIVERY' WHERE id = $1`,
      [shipmentIds[3]],
    );
  });
});
