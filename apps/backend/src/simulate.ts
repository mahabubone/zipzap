/**
 * The simulation engine (Phase 6 rung 4) — docs/operations/demo-scenarios.md.
 *
 *   pnpm --filter @zipzap/backend simulate shipment ZP-8F32A1 --scenario delivered
 *
 * Advances a real shipment through the REAL state machine and the REAL outbox:
 * every step is an application service (pickup, hub scans, delivery, attempts,
 * returns, exceptions), so the simulator can never demo a transition the
 * product cannot perform. It writes no status directly — that would make it a
 * tool that lies about the system.
 *
 * Reads go through each owning module's repository on that module's own
 * connection (rule 2): the simulator is a driver of services, not a special
 * case that gets to skip the boundary. Every step is guarded by the current
 * status, so a scenario resumes a half-finished shipment instead of blindly
 * replaying from CREATED, and an already-finished one reports "already there".
 */

import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { AppModule } from './app.module.ts';
import { FAILURE_REASONS, type FailureReason } from './modules/delivery/rules/delivery.ts';
import type { ShipmentStatus } from './modules/shipment/rules/state-machine.ts';
import { ShipmentRepository } from './modules/shipment/shipment.repository.ts';
import { PickupRepository } from './modules/pickup/pickup.repository.ts';
import { PickupEntity } from './modules/pickup/pickup.entity.ts';
import { DeliveryRepository } from './modules/delivery/delivery.repository.ts';
import { DeliveryJobEntity } from './modules/delivery/delivery.entity.ts';
import { ReturnRequestRepository } from './modules/returns/return-request.repository.ts';
import { RequestPickupService } from './modules/pickup/request-pickup.service.ts';
import { AssignPickupService } from './modules/pickup/assign-pickup.service.ts';
import { ScanParcelService } from './modules/pickup/scan-parcel.service.ts';
import { RegisterRiderService } from './modules/rider/register-rider.service.ts';
import { HubScanService } from './modules/hub/hub-scan.service.ts';
import { CreateDeliveryService } from './modules/delivery/create-delivery.service.ts';
import { AdvanceDeliveryService } from './modules/delivery/advance-delivery.service.ts';
import { RecordAttemptService } from './modules/delivery/record-attempt.service.ts';
import { ReturnService } from './modules/returns/return.service.ts';
import { ReportExceptionService } from './modules/shipment/report-exception.service.ts';

export const SCENARIOS = [
  'delivered',
  'failed-then-delivered',
  'customer-refused',
  'returned',
  'lost',
  'damaged',
] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** What "done" means per scenario — also the idempotency guard on re-runs. */
const FINAL_STATUS: Record<Scenario, ShipmentStatus> = {
  delivered: 'DELIVERED',
  'failed-then-delivered': 'DELIVERED',
  'customer-refused': 'RETURN_INITIATED',
  returned: 'RETURNED',
  lost: 'LOST',
  damaged: 'DAMAGED',
};

export interface SimulationResult {
  readonly scenario: Scenario;
  readonly trackingCode: string;
  readonly finalStatus: string;
  readonly steps: readonly string[];
}

export function usageError(message: string): Error {
  return new Error(
    `${message}\nusage: simulate shipment <tracking-code> --scenario <${SCENARIOS.join('|')}>`,
  );
}

/** CLI argv → validated inputs. Throws before any process boots. */
export function parseArgs(argv: readonly string[]): {
  trackingCode: string;
  scenario: Scenario;
} {
  if (argv[0] !== 'shipment') throw usageError('first argument must be "shipment".');
  const trackingCode = argv[1];
  if (!trackingCode || trackingCode.startsWith('--')) {
    throw usageError('a tracking code is required.');
  }
  const inline = argv.find((a) => a.startsWith('--scenario='))?.slice('--scenario='.length);
  const flagIndex = argv.indexOf('--scenario');
  const raw = inline ?? (flagIndex >= 0 ? argv[flagIndex + 1] : undefined);
  if (!raw || !(SCENARIOS as readonly string[]).includes(raw)) {
    throw usageError(`--scenario must be one of: ${SCENARIOS.join(', ')}.`);
  }
  return { trackingCode, scenario: raw as Scenario };
}

/** The seeded corridor (migration 0025), exactly as the flagship story walks it. */
const CORRIDOR: ReadonlyArray<{
  readonly from: ShipmentStatus;
  readonly scan: 'INBOUND' | 'SORT' | 'OUTBOUND' | 'DEPARTED' | 'ARRIVED';
  readonly hubCode: string;
}> = [
  { from: 'PICKED_UP', scan: 'INBOUND', hubCode: 'DAC-D' },
  { from: 'AT_ORIGIN_HUB', scan: 'SORT', hubCode: 'DAC-D' },
  { from: 'SORTING', scan: 'OUTBOUND', hubCode: 'DAC-R' },
  { from: 'DISPATCHED', scan: 'DEPARTED', hubCode: 'DAC-R' },
  { from: 'IN_TRANSIT', scan: 'ARRIVED', hubCode: 'CGP-D' },
];

function simKey(scenario: Scenario): string {
  return `simulate-${scenario}-${randomUUID()}`;
}

/** BD mobile number, unique per call — riders.phone is unique. */
function simPhone(): string {
  return `+88017${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

export async function runSimulation(
  trackingCode: string,
  scenario: Scenario,
  providedApp?: INestApplicationContext,
): Promise<SimulationResult> {
  const app = providedApp ?? (await NestFactory.createApplicationContext(AppModule));
  try {
    return await drive(app, trackingCode, scenario);
  } finally {
    if (!providedApp) await app.close();
  }
}

/** The handful of fields a scenario actually reads. */
interface SimulatedShipment {
  readonly id: string;
  readonly status: ShipmentStatus;
  readonly merchantId: string;
  readonly codAmountMinor: number;
  readonly parcelWeightGrams: number;
}

async function drive(
  app: INestApplicationContext,
  trackingCode: string,
  scenario: Scenario,
): Promise<SimulationResult> {
  // ---- every read through the owning module's connection (rule 2) ----------
  const shipmentDs = app.get<DataSource>('shipmentDataSource');
  const pickupDs = app.get<DataSource>('pickupDataSource');
  const deliveryDs = app.get<DataSource>('deliveryDataSource');
  const returnsDs = app.get<DataSource>('returnsDataSource');
  const shipments = app.get(ShipmentRepository);
  const pickups = app.get(PickupRepository);
  const jobs = app.get(DeliveryRepository);
  const returnRequests = app.get(ReturnRequestRepository);

  const load = async (): Promise<SimulatedShipment> => {
    const found = await shipmentDs.transaction((m) =>
      shipments.findByTrackingCode(m, trackingCode),
    );
    if (!found) throw new Error(`no shipment with tracking code ${trackingCode}.`);
    return {
      id: found.id,
      status: found.status,
      merchantId: found.merchantId,
      codAmountMinor: Number(found.codAmountMinor ?? 0),
      parcelWeightGrams: Number(found.parcelWeightGrams ?? 0),
    };
  };

  const pickupFor = (): Promise<PickupEntity | null> =>
    pickupDs.transaction((m) => pickups.findByShipmentId(m, row.id));

  const latestJob = (): Promise<DeliveryJobEntity | null> =>
    deliveryDs.transaction((m) => jobs.findLatestByShipmentId(m, row.id));

  const returnFor = () => returnsDs.transaction((m) => returnRequests.findByShipmentId(m, row.id));

  const steps: string[] = [];
  const step = (label: string): void => {
    steps.push(label);
    console.log(`  → ${label}`);
  };

  let row = await load();
  if (row.status === FINAL_STATUS[scenario]) {
    step(`already ${FINAL_STATUS[scenario]} — nothing to do`);
    return { scenario, trackingCode, finalStatus: row.status, steps };
  }

  // A fresh rider every run: unique phone, capacity for the parcel, and the
  // actor id every later step records (scans, attempts, returns, exceptions).
  const rider = await app.get(RegisterRiderService).execute({
    displayName: 'Simulated Rider',
    phone: simPhone(),
    capacity: 3,
  });
  step(`rider registered (${rider.id})`);

  const requestPickup = app.get(RequestPickupService);
  const assignPickup = app.get(AssignPickupService);
  const scanParcel = app.get(ScanParcelService);
  const hubScan = app.get(HubScanService);
  const createDelivery = app.get(CreateDeliveryService);
  const advanceDelivery = app.get(AdvanceDeliveryService);
  const recordAttempt = app.get(RecordAttemptService);
  const returns = app.get(ReturnService);
  const reportException = app.get(ReportExceptionService);

  // ---- shared forward path: CREATED … PICKED_UP (all scenarios) ------------
  if (row.status === 'CREATED') {
    await requestPickup.execute({
      merchantId: row.merchantId,
      shipmentIds: [row.id],
      totalWeightGrams: row.parcelWeightGrams,
      idempotencyKey: simKey(scenario),
      actorId: null,
    });
    step('pickup requested');
    row = await load();
  }
  if (row.status === 'PICKUP_REQUESTED') {
    const pickup = await pickupFor();
    if (!pickup) throw new Error('no pickup row found for this shipment.');
    await assignPickup.execute({
      pickupId: pickup.id,
      candidates: [
        { riderId: rider.id, distanceMetres: 900, activeJobs: 0, capacity: 3, recentRefusals: 0 },
      ],
      idempotencyKey: simKey(scenario),
      actorId: null,
    });
    step('rider assigned to the pickup');
    row = await load();
  }
  if (row.status === 'PICKUP_ASSIGNED') {
    const pickup = await pickupFor();
    if (!pickup) throw new Error('no pickup row found for this shipment.');
    await scanParcel.execute({
      pickupId: pickup.id,
      shipmentId: row.id,
      actorId: rider.id,
    });
    step('parcel scanned — pickup complete');
    row = await load();
  }

  /** Walk the hub corridor until the shipment lands on `stopAt`. */
  const walkCorridorTo = async (stopAt: ShipmentStatus): Promise<void> => {
    for (;;) {
      row = await load();
      if (row.status === stopAt) return;
      const next = CORRIDOR.find((c) => c.from === row.status);
      if (!next) {
        throw new Error(
          `cannot drive scenario "${scenario}": shipment is ${row.status}, ` +
            `which is not on the corridor to ${stopAt}.`,
        );
      }
      const result = await hubScan.execute({
        shipmentId: row.id,
        scan: next.scan,
        hubCode: next.hubCode,
        actorId: null,
      });
      step(`${next.scan.toLowerCase()} scan at ${next.hubCode} → ${result.status}`);
    }
  };

  /** Through the corridor to the destination hub, job accepted and dispatched. */
  const ensureOutForDelivery = async (): Promise<string> => {
    row = await load();
    if (row.status !== 'OUT_FOR_DELIVERY') {
      await walkCorridorTo('AT_DESTINATION_HUB');
      row = await load();
    }
    if (row.status === 'OUT_FOR_DELIVERY') {
      const job = await latestJob();
      if (!job) throw new Error('shipment is out for delivery but has no delivery job.');
      return job.id;
    }

    let job = await latestJob();
    if (!job) {
      const created = await createDelivery.execute({
        shipmentId: row.id,
        riderId: rider.id,
        idempotencyKey: simKey(scenario),
        actorId: null,
      });
      job = await deliveryDs.transaction((m) => jobs.findById(m, created.result.id));
      step('delivery job created');
    }
    if (!job) throw new Error('delivery job disappeared mid-simulation.');
    if (job.status === 'ASSIGNED') {
      await advanceDelivery.accept(job.id);
      step('rider accepted the job');
    }
    const jobStatus = job.status === 'ASSIGNED' ? 'ACCEPTED' : job.status;
    if (jobStatus === 'ACCEPTED') {
      await advanceDelivery.dispatch(job.id, rider.id);
      step('rider dispatched — out for delivery');
    }
    row = await load();
    return job.id;
  };

  const attempt = async (jobId: string, reason: FailureReason, note: string): Promise<void> => {
    if (!(FAILURE_REASONS as readonly string[]).includes(reason)) {
      throw new Error(`unknown failure reason ${reason}.`);
    }
    await recordAttempt.execute({
      jobId,
      reason,
      note,
      idempotencyKey: simKey(scenario),
      actorId: rider.id,
    });
    row = await load();
    step(`attempt recorded (${reason}) → shipment ${row.status}`);
  };

  /** Request (if absent), approve (if undecided), then walk `legs` custody legs. */
  const walkReturn = async (legs: number): Promise<void> => {
    let returnRow = await returnFor();
    if (!returnRow) {
      await returns.request({
        shipmentId: row.id,
        merchantId: row.merchantId,
        reason: 'CUSTOMER_REFUSED',
        idempotencyKey: simKey(scenario),
      });
      step('return requested');
      returnRow = await returnFor();
    }
    if (!returnRow) throw new Error('return request disappeared mid-simulation.');
    if (returnRow.status === 'RETURN_REQUESTED') {
      await returns.decide({
        returnId: returnRow.id,
        approverId: rider.id,
        note: 'simulated merchant approval',
        approve: true,
      });
      step('return approved');
    }
    for (let leg = 0; leg < legs; leg++) {
      returnRow = await returnFor();
      if (!returnRow || returnRow.status === 'RETURNED') break;
      await returns.advance({ returnId: returnRow.id, actorId: rider.id });
      row = await load();
      step(`return leg → ${row.status}`);
    }
  };

  // ---- scenario tails ------------------------------------------------------
  switch (scenario) {
    case 'delivered': {
      let jobId: string;
      if (row.status === 'RETRY_SCHEDULED') {
        const job = await latestJob();
        if (!job) throw new Error('retry scheduled but no delivery job exists.');
        jobId = job.id;
      } else {
        jobId = await ensureOutForDelivery();
      }
      await advanceDelivery.complete(jobId, {
        collectedMinor: row.codAmountMinor,
        idempotencyKey: simKey(scenario),
        actorId: rider.id,
      });
      step('delivered, COD collected');
      break;
    }

    case 'failed-then-delivered': {
      let jobId: string;
      if (row.status === 'RETRY_SCHEDULED') {
        const job = await latestJob();
        if (!job) throw new Error('retry scheduled but no delivery job exists.');
        jobId = job.id;
      } else {
        jobId = await ensureOutForDelivery();
        await attempt(
          jobId,
          'PHONE_UNREACHABLE',
          'simulated: customer not home on the first visit',
        );
      }
      await advanceDelivery.complete(jobId, {
        collectedMinor: row.codAmountMinor,
        idempotencyKey: simKey(scenario),
        actorId: rider.id,
      });
      step('delivered on the retry, COD collected');
      break;
    }

    case 'customer-refused': {
      if (row.status === 'DELIVERY_FAILED') {
        await walkReturn(1);
        break;
      }
      const jobId = await ensureOutForDelivery();
      await attempt(jobId, 'CUSTOMER_REFUSED', 'simulated: refused at the door');
      await walkReturn(1);
      break;
    }

    case 'returned': {
      if (row.status !== 'DELIVERY_FAILED') {
        const jobId = await ensureOutForDelivery();
        await attempt(jobId, 'CUSTOMER_REFUSED', 'simulated: refused at the door');
      }
      await walkReturn(5);
      break;
    }

    case 'lost': {
      await walkCorridorTo('IN_TRANSIT');
      await reportException.execute({
        shipmentId: row.id,
        reason: 'LOST',
        note: 'simulated: parcel lost in the line-haul network',
        actorId: rider.id,
      });
      step('exception raised — LOST');
      break;
    }

    case 'damaged': {
      await walkCorridorTo('SORTING');
      await reportException.execute({
        shipmentId: row.id,
        reason: 'DAMAGED',
        note: 'simulated: parcel found damaged at hub sort',
        actorId: rider.id,
      });
      step('exception raised — DAMAGED');
      break;
    }
  }

  row = await load();
  if (row.status !== FINAL_STATUS[scenario]) {
    throw new Error(
      `scenario "${scenario}" ended at ${row.status}, expected ${FINAL_STATUS[scenario]}.`,
    );
  }
  step(`final status: ${row.status}`);
  return { scenario, trackingCode, finalStatus: row.status, steps };
}

/** CLI entrypoint. Parses first — argv errors never boot the app. */
async function main(): Promise<void> {
  const { trackingCode, scenario } = parseArgs(process.argv.slice(2));
  console.log(`simulating "${scenario}" on ${trackingCode}…`);
  const result = await runSimulation(trackingCode, scenario);
  console.log(`done: ${result.trackingCode} → ${result.finalStatus}`);
}

if (/simulate\.(?:js|ts)$/.test(process.argv[1] ?? '')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
