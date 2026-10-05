/**
 * THE FAILURE STORY — the courier's bad day, end to end.
 *
 *   refused → retry → refused → return → merchant receives it
 *
 * "Refused" in the story's first breath is a customer who is not home
 * (CUSTOMER_UNAVAILABLE — retryable, budget left). The second refusal is a
 * real CUSTOMER_REFUSED — terminal — which parks the job at FAILED and the
 * shipment at DELIVERY_FAILED, and only then does the return begin: request →
 * approve → five custody legs → RETURNED, the merchant receiving the parcel.
 *
 * Every step is a real service against real Postgres (skipped without
 * DATABASE_URL), with the shipment's own status asserted after each one — the
 * same rigour as flagship-story, because a failure path that silently fails to
 * move the aggregate is exactly the bug class ShipmentAdvanceService closed.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { money } from '../../dist/common/money.js';
import { connectModuleDataSource } from '../../dist/database/module-connection.js';

import { CreateShipmentService } from '../../dist/modules/shipment/create-shipment.service.js';
import { ShipmentRepository } from '../../dist/modules/shipment/shipment.repository.js';
import { ShipmentAdvanceService } from '../../dist/modules/shipment/advance-shipment.service.js';
import { ShipmentEntity } from '../../dist/modules/shipment/shipment.entity.js';
import { AppendTrackingEventService } from '../../dist/modules/tracking/append-tracking-event.service.js';
import { TrackingEventEntity } from '../../dist/modules/tracking/tracking-event.entity.js';
import { PublicTimelineEntity } from '../../dist/modules/tracking/public-timeline.entity.js';
import { PricingService } from '../../dist/modules/pricing/pricing.service.js';
import { PricingRepository } from '../../dist/modules/pricing/pricing.repository.js';
import { PricingVersionEntity } from '../../dist/modules/pricing/pricing-version.entity.js';
import { EnsureCodRecordService } from '../../dist/modules/cod/ensure-cod-record.service.js';
import { CodRecordEntity } from '../../dist/modules/cod/cod-record.entity.js';
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
import { RecordAttemptService } from '../../dist/modules/delivery/record-attempt.service.js';
import { DeliveryRepository } from '../../dist/modules/delivery/delivery.repository.js';
import { DeliveryJobEntity } from '../../dist/modules/delivery/delivery.entity.js';
import { DeliveryAttemptEntity } from '../../dist/modules/delivery/delivery-attempt.entity.js';
import { ReturnService } from '../../dist/modules/returns/return.service.js';
import { ReturnRequestRepository } from '../../dist/modules/returns/return-request.repository.js';
import { ReturnRequestEntity } from '../../dist/modules/returns/return-request.entity.js';
import { CodLookup } from '../../dist/modules/cod/cod.lookup.js';
import { CodRecordRepository } from '../../dist/modules/cod/cod-record.repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

let shipmentDb: DataSource;
let trackingDb: DataSource;
let codDb: DataSource;
let pickupDb: DataSource;
let riderDb: DataSource;
let deliveryDb: DataSource;
let returnsDb: DataSource;

let createShipment: CreateShipmentService;
let requestPickup: RequestPickupService;
let assignPickup: AssignPickupService;
let scanParcel: ScanParcelService;
let hubScan: HubScanService;
let createDelivery: CreateDeliveryService;
let advanceDelivery: AdvanceDeliveryService;
let recordAttempt: RecordAttemptService;
let returns: ReturnService;

const MERCHANT = randomUUID();

async function shipmentStatus(id: string): Promise<string> {
  const rows = (await shipmentDb.query(`SELECT status FROM shipment.shipments WHERE id = $1`, [
    id,
  ])) as { status: string }[];
  return rows[0]?.status ?? 'missing';
}

before(async () => {
  if (!databaseUrl) return;
  shipmentDb = await connectModuleDataSource('shipment', [ShipmentEntity]);
  trackingDb = await connectModuleDataSource('tracking', [
    TrackingEventEntity,
    PublicTimelineEntity,
  ]);
  codDb = await connectModuleDataSource('cod', [CodRecordEntity]);
  pickupDb = await connectModuleDataSource('pickup', [PickupEntity]);
  riderDb = await connectModuleDataSource('rider', [RiderEntity]);
  deliveryDb = await connectModuleDataSource('delivery', [
    DeliveryJobEntity,
    DeliveryAttemptEntity,
  ]);
  returnsDb = await connectModuleDataSource('returns', [ReturnRequestEntity]);
  const pricingDb = await connectModuleDataSource('pricing', [PricingVersionEntity]);
  const networkDb = await connectModuleDataSource('network', [ServiceAreaEntity]);

  const tracking = new AppendTrackingEventService();
  const shipmentRepo = new ShipmentRepository();
  const advance = new ShipmentAdvanceService();

  createShipment = new CreateShipmentService(
    shipmentDb,
    shipmentRepo,
    tracking,
    new PricingService(pricingDb, new PricingRepository()),
    new EnsureCodRecordService(codDb),
    new NetworkService(networkDb),
  );
  const ridersRepo = new RiderRepository();
  const pickupsRepo = new PickupRepository();
  requestPickup = new RequestPickupService(pickupDb, pickupsRepo, tracking, advance);
  assignPickup = new AssignPickupService(
    pickupDb,
    pickupsRepo,
    tracking,
    new AssignRiderService(riderDb, ridersRepo),
    advance,
  );
  scanParcel = new ScanParcelService(pickupDb, pickupsRepo, tracking, advance);
  hubScan = new HubScanService(await connectModuleDataSource('hub', []), advance, tracking);
  const deliveryRepo = new DeliveryRepository();
  createDelivery = new CreateDeliveryService(deliveryDb, deliveryRepo);
  advanceDelivery = new AdvanceDeliveryService(
    deliveryDb,
    deliveryRepo,
    tracking,
    new (await import('../../dist/modules/shipment/shipment.lookup.js')).ShipmentLookup(
      shipmentDb,
      shipmentRepo,
    ),
    advance,
    new (await import('../../dist/modules/cod/collect-cod.service.js')).CollectCodService(
      codDb,
      new CodRecordRepository(),
      tracking,
    ),
  );
  recordAttempt = new RecordAttemptService(deliveryDb, deliveryRepo, tracking, advance);
  returns = new ReturnService(
    returnsDb,
    new ReturnRequestRepository(),
    tracking,
    new CodLookup(codDb, new CodRecordRepository()),
    advance,
  );
});

after(async () => {
  await shipmentDb?.destroy();
  await trackingDb?.destroy();
  await codDb?.destroy();
  await pickupDb?.destroy();
  await riderDb?.destroy();
  await deliveryDb?.destroy();
  await returnsDb?.destroy();
});

describeIfDb('the failure story — refused, retried, refused, returned', () => {
  test('runs to RETURNED with the shipment status asserted after every step', async () => {
    // 1. Order + pickup + hub corridor, exactly as the flagship runs it.
    const created = await createShipment.execute({
      merchantId: MERCHANT,
      merchantPlan: 'standard',
      zone: 'dhaka-metro',
      remoteArea: false,
      fragile: false,
      packagingKind: null,
      sender: { name: 'Ayesha', phone: '+8801700000000', line: 'Dhaka' },
      recipient: { name: 'Joynal', phone: '+8801800000000', line: 'Chattogram' },
      parcel: { weightGrams: 900, description: 'One pot' },
      cod: money(50_000),
      idempotencyKey: `failstory-${randomUUID()}`,
      actorId: null,
    });
    const shipmentId = created.result.id;
    assert.equal(await shipmentStatus(shipmentId), 'CREATED');

    const pickup = await requestPickup.execute({
      merchantId: MERCHANT,
      shipmentIds: [shipmentId],
      totalWeightGrams: 900,
      idempotencyKey: `failstory-${randomUUID()}`,
      actorId: null,
    });
    const rider = await registerRiderForRun();
    await assignPickup.execute({
      pickupId: pickup.result.id,
      candidates: [
        { riderId: rider, distanceMetres: 700, activeJobs: 0, capacity: 3, recentRefusals: 0 },
      ],
      idempotencyKey: `failstory-${randomUUID()}`,
      actorId: null,
    });
    await scanParcel.execute({ pickupId: pickup.result.id, shipmentId, actorId: rider });
    assert.equal(await shipmentStatus(shipmentId), 'PICKED_UP');

    for (const [scan, hubCode] of [
      ['INBOUND', 'DAC-D'],
      ['SORT', 'DAC-D'],
      ['OUTBOUND', 'DAC-R'],
      ['DEPARTED', 'DAC-R'],
      ['ARRIVED', 'CGP-D'],
    ] as const) {
      await hubScan.execute({ shipmentId, scan, hubCode, actorId: null });
    }
    assert.equal(await shipmentStatus(shipmentId), 'AT_DESTINATION_HUB');

    const job = await createDelivery.execute({
      shipmentId,
      riderId: rider,
      idempotencyKey: `failstory-${randomUUID()}`,
      actorId: null,
    });
    await advanceDelivery.accept(job.result.id);
    await advanceDelivery.dispatch(job.result.id, rider);
    assert.equal(await shipmentStatus(shipmentId), 'OUT_FOR_DELIVERY');

    // 2. First attempt: nobody home — retryable, budget left. The job goes back
    //    out; the parcel parks at RETRY_SCHEDULED ("will go out again").
    const attempt1 = await recordAttempt.execute({
      jobId: job.result.id,
      reason: 'CUSTOMER_UNAVAILABLE',
      idempotencyKey: `failstory-${randomUUID()}`,
      actorId: rider,
    });
    assert.equal(attempt1.result.status, 'OUT_FOR_DELIVERY', 'job retries');
    assert.equal(attempt1.result.retryScheduled, true);
    assert.equal(
      await shipmentStatus(shipmentId),
      'RETRY_SCHEDULED',
      'the parcel shows a retry is planned',
    );

    // 3. Second attempt: a real refusal — terminal. Job FAILED; the parcel walks
    //    RETRY_SCHEDULED → OUT_FOR_DELIVERY (rider is out again) → DELIVERY_FAILED.
    const attempt2 = await recordAttempt.execute({
      jobId: job.result.id,
      reason: 'CUSTOMER_REFUSED',
      note: 'customer refused the parcel at the door, second visit',
      idempotencyKey: `failstory-${randomUUID()}`,
      actorId: rider,
    });
    assert.equal(attempt2.result.status, 'FAILED', 'terminal refusal ends the job');
    assert.equal(
      await shipmentStatus(shipmentId),
      'DELIVERY_FAILED',
      'and parks the parcel where returns begin',
    );

    // 4. Return: request, merchant approves, five custody legs, merchant receives.
    const requested = await returns.request({
      shipmentId,
      merchantId: MERCHANT,
      reason: 'CUSTOMER_REFUSED',
      idempotencyKey: `failstory-${randomUUID()}`,
    });
    assert.equal(requested.result.status, 'RETURN_REQUESTED');
    assert.equal(
      await shipmentStatus(shipmentId),
      'DELIVERY_FAILED',
      'requesting does not yet move the parcel — nobody approved',
    );

    await returns.decide({
      returnId: requested.result.id,
      approverId: randomUUID(),
      note: 'customer refused twice; recall the parcel',
      approve: true,
    });
    assert.equal(
      await shipmentStatus(shipmentId),
      'DELIVERY_FAILED',
      'approval alone moves nothing',
    );

    let lastLeg = '';
    for (let leg = 0; leg < 5; leg++) {
      const advanced = await returns.advance({
        returnId: requested.result.id,
        actorId: rider,
      });
      lastLeg = advanced.status;
      // The parcel and the request walk the same leg names, in lockstep.
      assert.equal(
        await shipmentStatus(shipmentId),
        advanced.status,
        `shipment follows leg ${advanced.status}`,
      );
    }
    assert.equal(lastLeg, 'RETURNED', 'the merchant receives the parcel back');
    assert.equal(await shipmentStatus(shipmentId), 'RETURNED');

    // The timeline carries both attempts and the return's end.
    const rows = (await trackingDb.query(
      `SELECT event_type, count(*)::int AS n FROM tracking.events WHERE shipment_id = $1
        GROUP BY event_type`,
      [shipmentId],
    )) as { event_type: string; n: number }[];
    const counts = Object.fromEntries(rows.map((row) => [row.event_type, row.n]));
    assert.equal(counts.DELIVERY_ATTEMPTED, 2, 'two attempts, two timeline rows');
    assert.equal(counts.RETURNED, 1, 'the return ends exactly once');
    assert.equal(
      counts.OUT_FOR_DELIVERY,
      1,
      'still one outbound — refusal is not a second dispatch',
    );
  });

  test('a second return for the same parcel is refused', async () => {
    // One return per parcel, ever — the unique index and the service agree.
    const created = await createShipment.execute({
      merchantId: MERCHANT,
      merchantPlan: 'standard',
      zone: 'dhaka-metro',
      remoteArea: false,
      fragile: false,
      packagingKind: null,
      sender: { name: 'Ayesha', phone: '+8801700000000', line: 'Dhaka' },
      recipient: { name: 'Karim', phone: '+8801800000000', line: 'Dhaka' },
      parcel: { weightGrams: 400, description: 'Mug' },
      cod: money(0),
      idempotencyKey: `failstory2-${randomUUID()}`,
      actorId: null,
    });
    await returns.request({
      shipmentId: created.result.id,
      merchantId: MERCHANT,
      reason: 'DAMAGED',
      idempotencyKey: `failstory2-${randomUUID()}`,
    });
    await assert.rejects(
      () =>
        returns.request({
          shipmentId: created.result.id,
          merchantId: MERCHANT,
          reason: 'DAMAGED',
          idempotencyKey: `failstory2-${randomUUID()}`,
        }),
      /already has a return/,
    );
  });
});

async function registerRiderForRun(): Promise<string> {
  const rider = await new RegisterRiderService(riderDb, new RiderRepository()).execute({
    displayName: 'Joynal',
    phone: `+88018${String(Date.now()).slice(-8)}`,
    capacity: 3,
  });
  return rider.id;
}
