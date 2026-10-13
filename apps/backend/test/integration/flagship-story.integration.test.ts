/**
 * THE FLAGSHIP STORY — one shipment, end to end, in the seeded network.
 *
 *   create → pickup requested → rider assigned → rider picks up
 *   → origin hub scan → sort → dispatch → line-haul → destination hub
 *   → rider assigned → out for delivery → COD collected → DELIVERED
 *
 * Every step is a REAL service against real Postgres (skipped without
 * DATABASE_URL), and after every step the shipment's own status is asserted —
 * the box this proves is "runs to DELIVERED in a seeded network", and the
 * interesting failure is a step that quietly failed to move the aggregate
 * (which is exactly what was broken before ShipmentAdvanceService existed:
 * 20,230 rows stuck in CREATED).
 *
 * The network is the seeded one: hubs DAC-D/DAC-R/CGP-D (migration 0025) and
 * their geography points — scans name real hub codes.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { money } from '../../dist/common/money.js';
import { connectModuleDataSource } from '../../dist/database/module-connection.js';
import { buildHubScan, buildPricingService, recordVerifiedProof } from './harness.ts';

import { CreateShipmentService } from '../../dist/modules/shipment/create-shipment.service.js';
import { ShipmentRepository } from '../../dist/modules/shipment/shipment.repository.js';
import { ShipmentAdvanceService } from '../../dist/modules/shipment/advance-shipment.service.js';
import { ShipmentLookup } from '../../dist/modules/shipment/shipment.lookup.js';
import { ShipmentEntity } from '../../dist/modules/shipment/shipment.entity.js';
import { AppendTrackingEventService } from '../../dist/modules/tracking/append-tracking-event.service.js';
import { TrackingEventEntity } from '../../dist/modules/tracking/tracking-event.entity.js';
import { PublicTimelineEntity } from '../../dist/modules/tracking/public-timeline.entity.js';
import { EnsureCodRecordService } from '../../dist/modules/cod/ensure-cod-record.service.js';
import { CodRecordEntity } from '../../dist/modules/cod/cod-record.entity.js';
import { CollectCodService } from '../../dist/modules/cod/collect-cod.service.js';
import { CodRecordRepository } from '../../dist/modules/cod/cod-record.repository.js';
import { NetworkService } from '../../dist/modules/network/network.service.js';
import { ServiceAreaEntity } from '../../dist/modules/network/service-area.entity.js';
import { RegisterRiderService } from '../../dist/modules/rider/register-rider.service.js';
import { RiderRepository } from '../../dist/modules/rider/rider.repository.js';
import { RiderEntity } from '../../dist/modules/rider/rider.entity.js';
import { AssignRiderService } from '../../dist/modules/rider/assign-rider.service.js';
import { RequestPickupService } from '../../dist/modules/pickup/request-pickup.service.js';
import { AssignPickupService } from '../../dist/modules/pickup/assign-pickup.service.js';
import { ScanParcelService } from '../../dist/modules/pickup/scan-parcel.service.js';
import { PickupEntity } from '../../dist/modules/pickup/pickup.entity.js';
import { PickupRepository } from '../../dist/modules/pickup/pickup.repository.js';
import { HubScanService } from '../../dist/modules/hub/hub-scan.service.js';
import { CreateDeliveryService } from '../../dist/modules/delivery/create-delivery.service.js';
import { AdvanceDeliveryService } from '../../dist/modules/delivery/advance-delivery.service.js';
import { DeliveryRepository } from '../../dist/modules/delivery/delivery.repository.js';
import { DeliveryJobEntity } from '../../dist/modules/delivery/delivery.entity.js';
import { DeliveryAttemptEntity } from '../../dist/modules/delivery/delivery-attempt.entity.js';
import { DeliveryProofEntity } from '../../dist/modules/delivery/delivery-proof.entity.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

let shipmentDb: DataSource;
let trackingDb: DataSource;
let systemDb: DataSource;
let codDb: DataSource;
let pickupDb: DataSource;
let riderDb: DataSource;
let deliveryDb: DataSource;
let pricing: Awaited<ReturnType<typeof buildPricingService>>;
let hubScanHarness: Awaited<ReturnType<typeof buildHubScan>>;
let networkDb: DataSource;

let createShipment: CreateShipmentService;
let advanceShipment: ShipmentAdvanceService;
let registerRider: RegisterRiderService;
let requestPickup: RequestPickupService;
let assignPickup: AssignPickupService;
let scanParcel: ScanParcelService;
let hubScan: HubScanService;
let createDelivery: CreateDeliveryService;
let advanceDelivery: AdvanceDeliveryService;

const MERCHANT = randomUUID();
const COD_MINOR = 125_050;

async function shipmentStatus(id: string): Promise<string> {
  const rows = (await shipmentDb.query(`SELECT status FROM shipment.shipments WHERE id = $1`, [
    id,
  ])) as { status: string }[];
  return rows[0]?.status ?? 'missing';
}

async function eventTypes(shipmentId: string): Promise<string[]> {
  const rows = (await trackingDb.query(
    `SELECT event_type FROM tracking.events WHERE shipment_id = $1`,
    [shipmentId],
  )) as { event_type: string }[];
  return rows.map((row) => row.event_type);
}

async function outboxTypes(aggregateType: string, aggregateId: string): Promise<string[]> {
  const rows = (await systemDb.query(
    `SELECT event_type FROM system.outbox_events WHERE aggregate_type = $1 AND aggregate_id = $2`,
    [aggregateType, aggregateId],
  )) as { event_type: string }[];
  return rows.map((row) => row.event_type);
}

before(async () => {
  if (!databaseUrl) return;
  shipmentDb = await connectModuleDataSource('shipment', [ShipmentEntity]);
  trackingDb = await connectModuleDataSource('tracking', [
    TrackingEventEntity,
    PublicTimelineEntity,
  ]);
  systemDb = await connectModuleDataSource('system', []);
  codDb = await connectModuleDataSource('cod', [CodRecordEntity]);
  pickupDb = await connectModuleDataSource('pickup', [PickupEntity]);
  riderDb = await connectModuleDataSource('rider', [RiderEntity]);
  deliveryDb = await connectModuleDataSource('delivery', [
    DeliveryJobEntity,
    DeliveryAttemptEntity,
    // Registered alongside the other two because completing a delivery writes a proof row.
    // Omitting it did not fail loudly at connect time — it failed on first use, with
    // `No metadata for "DeliveryProofEntity" was found`, in whichever test happened to
    // deliver a parcel first. A module connection that is missing an entity is a latent
    // failure wherever that entity is touched.
    DeliveryProofEntity,
  ]);
  // Wired once in harness.ts so a PricingService constructor change is one edit here
  // rather than a silent runtime `undefined` in four suites.
  const pricing = await buildPricingService();
  const networkDb = await connectModuleDataSource('network', [ServiceAreaEntity]);
  const hubScanHarness = await buildHubScan();
  hubScan = hubScanHarness.service;

  const tracking = new AppendTrackingEventService();
  const shipmentRepo = new ShipmentRepository();
  advanceShipment = new ShipmentAdvanceService();

  createShipment = new CreateShipmentService(
    shipmentDb,
    shipmentRepo,
    tracking,
    pricing.service,
    new EnsureCodRecordService(codDb),
    new NetworkService(networkDb),
  );
  const ridersRepo = new RiderRepository();
  registerRider = new RegisterRiderService(riderDb, ridersRepo);
  const pickupsRepo = new PickupRepository();
  requestPickup = new RequestPickupService(pickupDb, pickupsRepo, tracking, advanceShipment);
  assignPickup = new AssignPickupService(
    pickupDb,
    pickupsRepo,
    tracking,
    new AssignRiderService(riderDb, ridersRepo),
    advanceShipment,
  );
  scanParcel = new ScanParcelService(pickupDb, pickupsRepo, tracking, advanceShipment);

  const deliveryRepo = new DeliveryRepository();
  createDelivery = new CreateDeliveryService(deliveryDb, deliveryRepo);
  advanceDelivery = new AdvanceDeliveryService(
    deliveryDb,
    deliveryRepo,
    tracking,
    new ShipmentLookup(shipmentDb, shipmentRepo),
    advanceShipment,
    new CollectCodService(codDb, new CodRecordRepository(), tracking),
  );
});

after(async () => {
  await shipmentDb?.destroy();
  await trackingDb?.destroy();
  await systemDb?.destroy();
  await codDb?.destroy();
  await pickupDb?.destroy();
  await riderDb?.destroy();
  await deliveryDb?.destroy();
  // The pricing and network connections were opened in `before` and never closed. They
  // are module-scoped DataSources, so a leaked one holds a pool open until the process
  // exits — harmless for one file, but these suites run in the same runner as 15 others.
  await pricing?.db.destroy();
  await pricing?.merchantDb.destroy();
  await networkDb?.destroy();
  await hubScanHarness?.hubDb.destroy();
  await hubScanHarness?.shipmentDb.destroy();
  await hubScanHarness?.trackingDb.destroy();
});

describeIfDb('the flagship story — merchant order to DELIVERED', () => {
  test('runs the whole chain in the seeded network, status asserted at every step', async () => {
    // 1. Merchant creates a COD order. Serviceability gates it (coverage rows).
    const created = await createShipment.execute({
      merchantId: MERCHANT,

      zone: 'dhaka-metro',
      remoteArea: false,
      fragile: false,
      packagingKind: null,
      sender: { name: 'Ayesha', phone: '+8801700000000', line: 'Dhaka' },
      recipient: { name: 'Rahim', phone: '+8801800000000', line: 'Chattogram' },
      parcel: { weightGrams: 1200, description: 'Two shirts' },
      cod: money(COD_MINOR),
      idempotencyKey: `flagship-${randomUUID()}`,
      actorId: null,
    });
    const shipmentId = created.result.id;
    assert.equal(await shipmentStatus(shipmentId), 'CREATED');

    // 2. Merchant requests pickup for the parcel.
    const pickup = await requestPickup.execute({
      merchantId: MERCHANT,
      shipmentIds: [shipmentId],
      totalWeightGrams: 1200,
      idempotencyKey: `flagship-${randomUUID()}`,
      actorId: null,
    });
    assert.equal(await shipmentStatus(shipmentId), 'PICKUP_REQUESTED', 'request moves the parcel');

    // A rider exists and is assigned to the batch. Phone is UNIQUE on riders —
    // derive it per run so re-running the suite never collides.
    const rider = await registerRider.execute({
      displayName: 'Kamal',
      phone: `+88017${String(Date.now()).slice(-8)}`,
      capacity: 3,
    });
    const assigned = await assignPickup.execute({
      pickupId: pickup.result.id,
      candidates: [
        {
          riderId: rider.id,
          distanceMetres: 900,
          activeJobs: 0,
          capacity: 3,
          recentRefusals: 0,
        },
      ],
      idempotencyKey: `flagship-${randomUUID()}`,
      actorId: null,
    });
    assert.equal(assigned.result.riderId, rider.id);
    assert.equal(await shipmentStatus(shipmentId), 'PICKUP_ASSIGNED');

    // 4. The rider scans the parcel out of the merchant's hands — required to
    //    complete the pickup (scan-parcel.service).
    const scanned = await scanParcel.execute({
      pickupId: pickup.result.id,
      shipmentId,
      actorId: rider.id,
    });
    assert.equal(await shipmentStatus(shipmentId), 'PICKED_UP');
    assert.equal(scanned.pickupStatus, 'COMPLETED', 'the only parcel was scanned: pickup closes');
    assert.equal(scanned.scannedCount, 1);

    // 5. The hub corridor, on seeded hub codes: inbound → sort → outbound →
    //    departed → arrived. Status asserted after every scan.
    const corridor: ReadonlyArray<[string, string, string]> = [
      ['INBOUND', 'DAC-D', 'AT_ORIGIN_HUB'],
      ['SORT', 'DAC-D', 'SORTING'],
      ['OUTBOUND', 'DAC-R', 'DISPATCHED'],
      ['DEPARTED', 'DAC-R', 'IN_TRANSIT'],
      ['ARRIVED', 'CGP-D', 'AT_DESTINATION_HUB'],
    ];
    for (const [scan, hubCode, expected] of corridor) {
      const result = await hubScan.execute({ shipmentId, scan, hubCode, actorId: null });
      assert.equal(result.status, expected, `${scan} at ${hubCode}`);
      assert.equal(await shipmentStatus(shipmentId), expected, `aggregate after ${scan}`);
    }

    // 6. Last-mile: a delivery job for the same rider, accepted and dispatched.
    const job = await createDelivery.execute({
      shipmentId,
      riderId: rider.id,
      idempotencyKey: `flagship-${randomUUID()}`,
      actorId: null,
    });
    assert.equal(
      await shipmentStatus(shipmentId),
      'AT_DESTINATION_HUB',
      'creating a job moves nothing',
    );
    await advanceDelivery.accept(job.result.id);
    assert.equal(await shipmentStatus(shipmentId), 'AT_DESTINATION_HUB', 'accept is internal');
    await advanceDelivery.dispatch(job.result.id, rider.id);
    assert.equal(await shipmentStatus(shipmentId), 'OUT_FOR_DELIVERY', 'dispatch moves the parcel');

    // 7. Delivery completes: shipment DELIVERED and COD collected in one transaction.
    // Proof first: `complete` refuses to mark anything delivered without verified evidence, which
    // is the rule doing its job rather than an obstacle to the story. Asserted explicitly below
    // so the absence of a proof cannot later become a silent pass.
    await assert.rejects(
      advanceDelivery.complete(job.result.id, {
        collectedMinor: COD_MINOR,
        idempotencyKey: `flagship-noproof-${randomUUID()}`,
        actorId: rider.id,
      }),
      /PROOF_REQUIRED|requires a proof/,
      'a delivery with no proof of delivery is refused',
    );
    await recordVerifiedProof(deliveryDb, job.result.id, rider.id);

    await advanceDelivery.complete(job.result.id, {
      collectedMinor: COD_MINOR,
      idempotencyKey: `flagship-${randomUUID()}`,
      actorId: rider.id,
    });
    assert.equal(await shipmentStatus(shipmentId), 'DELIVERED', 'THE STORY ENDS HERE');

    // The money agrees with the status: COD collected at the collected amount.
    const codRows = (await codDb.query(
      `SELECT status, collected_minor FROM cod.records WHERE shipment_id = $1`,
      [shipmentId],
    )) as { status: string; collected_minor: string }[];
    assert.equal(codRows[0]?.status, 'COD_COLLECTED');
    assert.equal(Number(codRows[0]?.collected_minor), COD_MINOR);

    // The timeline tells the same story, each fact exactly once.
    const timeline = await eventTypes(shipmentId);
    for (const expected of [
      'SHIPMENT_CREATED',
      'PICKUP_REQUESTED',
      'PICKUP_ASSIGNED',
      'PICKED_UP',
      'ARRIVED_AT_HUB',
      'SORTED',
      'DISPATCHED',
      'ARRIVED_AT_DESTINATION_HUB',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ]) {
      assert.equal(
        timeline.filter((type) => type === expected).length,
        1,
        `${expected} appears exactly once (got: ${timeline.join(', ')})`,
      );
    }

    // The outbox announced every mutation (rule 7) — the events other modules consume.
    const shipmentEvents = await outboxTypes('shipment', shipmentId);
    for (const expected of ['ShipmentCreated', 'ShipmentScanned']) {
      assert.ok(shipmentEvents.includes(expected), `outbox: ${expected}`);
    }
    assert.equal(
      shipmentEvents.filter((type) => type === 'ShipmentScanned').length,
      5,
      'five scans, five outbox rows',
    );
    const pickupEvents = await outboxTypes('pickup', pickup.result.id);
    for (const expected of ['PickupRequested', 'PickupAssigned', 'PickupParcelScanned']) {
      assert.ok(pickupEvents.includes(expected), `outbox: ${expected}`);
    }
    const deliveryEvents = await outboxTypes('delivery', job.result.id);
    for (const expected of [
      'DeliveryJobCreated',
      'DeliveryAccepted',
      'DeliveryOutForDelivery',
      'DeliveryCompleted',
    ]) {
      assert.ok(deliveryEvents.includes(expected), `outbox: ${expected}`);
    }
  });

  test('an out-of-order scan is rejected by the machine, not silently absorbed', async () => {
    const created = await createShipment.execute({
      merchantId: MERCHANT,

      zone: 'dhaka-metro',
      remoteArea: false,
      fragile: false,
      packagingKind: null,
      sender: { name: 'Ayesha', phone: '+8801700000000', line: 'Dhaka' },
      recipient: { name: 'Nayem', phone: '+8801800000000', line: 'Dhaka' },
      parcel: { weightGrams: 500, description: 'Book' },
      cod: money(0),
      idempotencyKey: `flagship-skip-${randomUUID()}`,
      actorId: null,
    });
    const shipmentId = created.result.id;

    // CREATED cannot be inbound-scanned: the parcel was never picked up.
    await assert.rejects(
      () => hubScan.execute({ shipmentId, scan: 'INBOUND', hubCode: 'DAC-D', actorId: null }),
      /Cannot move from CREATED to AT_ORIGIN_HUB/,
    );
    assert.equal(await shipmentStatus(shipmentId), 'CREATED', 'a rejected scan wrote nothing');

    // And an unknown scan kind never reaches the machine at all.
    const unknown = (await hubScan
      .execute({ shipmentId, scan: 'YEET', actorId: null })
      .catch((error: unknown) => error)) as {
      code?: string;
      issues?: { message: string }[];
    };
    assert.equal(unknown.code, 'VALIDATION_FAILED');
    assert.match(String(unknown.issues?.[0]?.message), /unknown scan/);
  });

  test('two riders scanning simultaneously: exactly one transition, one tracking event', async () => {
    // Get a parcel to the gate: create → request → assign → scanned (PICKED_UP).
    const created = await createShipment.execute({
      merchantId: MERCHANT,

      zone: 'dhaka-metro',
      remoteArea: false,
      fragile: false,
      packagingKind: null,
      sender: { name: 'Ayesha', phone: '+8801700000000', line: 'Dhaka' },
      recipient: { name: 'Rina', phone: '+8801800000000', line: 'Dhaka' },
      parcel: { weightGrams: 700, description: 'Race fixture' },
      cod: money(0),
      idempotencyKey: `race-${randomUUID()}`,
      actorId: null,
    });
    const shipmentId = created.result.id;

    const pickup = await requestPickup.execute({
      merchantId: MERCHANT,
      shipmentIds: [shipmentId],
      totalWeightGrams: 700,
      idempotencyKey: `race-${randomUUID()}`,
      actorId: null,
    });
    const rider = await new RegisterRiderService(riderDb, new RiderRepository()).execute({
      displayName: 'Racer',
      phone: `+88017${String(Date.now()).slice(-8)}`,
      capacity: 3,
    });
    await assignPickup.execute({
      pickupId: pickup.result.id,
      candidates: [
        {
          riderId: rider.id,
          distanceMetres: 500,
          activeJobs: 0,
          capacity: 3,
          recentRefusals: 0,
        },
      ],
      idempotencyKey: `race-${randomUUID()}`,
      actorId: null,
    });
    await scanParcel.execute({ pickupId: pickup.result.id, shipmentId, actorId: rider.id });
    assert.equal(await shipmentStatus(shipmentId), 'PICKED_UP');

    // Two riders scan the same parcel into the origin hub at the same moment.
    // The shipment row lock (SELECT … FOR UPDATE) serialises them: one commits
    // the transition, the other re-reads and 409s through the machine.
    const outcomes = await Promise.allSettled([
      hubScan.execute({ shipmentId, scan: 'INBOUND', hubCode: 'DAC-D', actorId: rider.id }),
      hubScan.execute({ shipmentId, scan: 'INBOUND', hubCode: 'DAC-D', actorId: null }),
    ]);
    const won = outcomes.filter((o) => o.status === 'fulfilled');
    const lost = outcomes.filter((o) => o.status === 'rejected');
    assert.equal(won.length, 1, 'exactly one scan wins');
    assert.equal(lost.length, 1, 'exactly one scan loses');
    assert.match(
      String((lost[0] as PromiseRejectedResult).reason),
      /Cannot move from/,
      'the loser is rejected by the machine, not silently dropped',
    );

    assert.equal(await shipmentStatus(shipmentId), 'AT_ORIGIN_HUB', 'one transition, not two');

    const rows = (await trackingDb.query(
      `SELECT event_type, count(*)::int AS n FROM tracking.events
        WHERE shipment_id = $1 AND event_type = 'ARRIVED_AT_HUB' GROUP BY event_type`,
      [shipmentId],
    )) as { n: number }[];
    assert.equal(rows[0]?.n, 1, 'exactly one tracking event');

    const scans = (await systemDb.query(
      `SELECT count(*)::int AS n FROM system.outbox_events
        WHERE aggregate_type = 'shipment' AND aggregate_id = $1 AND event_type = 'ShipmentScanned'`,
      [shipmentId],
    )) as { n: number }[];
    assert.equal(scans[0]?.n, 1, 'one outbox announcement — the loser rolled back');
  });
});
