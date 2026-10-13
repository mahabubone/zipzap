/**
 * Integration: the simulation engine drives all six scenarios end to end
 * (Phase 6 rung 4) — docs/operations/demo-scenarios.md.
 *
 * Each scenario runs against a real shipment in the seeded network, through
 * the REAL services (pickup, hub corridor, delivery, attempts, returns,
 * exceptions) — never a direct status write. The proof per scenario is the
 * shipment's own status at the end, plus the artifacts the spec names: COD
 * collected on `delivered`, a return initiated on `customer-refused`, a
 * completed return on `returned`, and the EXCEPTION_RAISED tracking event +
 * ShipmentExceptionRaised outbox announcement on `lost`/`damaged`.
 *
 * The `failed-then-delivered` run is also the regression proof for the
 * RETRY_SCHEDULED -> OUT_FOR_DELIVERY hop in AdvanceDeliveryService.complete —
 * without it, a success after a retryable attempt 409s on the machine.
 *
 * One app context is shared across scenarios: booting AppModule per run
 * would dominate the suite's runtime. Skipped without DATABASE_URL.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { AppModule } from '../../dist/app.module.js';
import { money } from '../../dist/common/money.js';
import { CreateShipmentService } from '../../dist/modules/shipment/create-shipment.service.js';
import { runSimulation, parseArgs, SCENARIOS, type Scenario } from '../../dist/simulate.js';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

let app: INestApplicationContext;
let shipmentDs: DataSource;
let systemDs: DataSource;
let trackingDs: DataSource;
let codDs: DataSource;
let returnsDs: DataSource;
let deliveryDs: DataSource;

const MERCHANT = randomUUID();
const COD_MINOR = 125_050;
const codes = new Map<Scenario, string>();

async function newShipment(scenario: Scenario): Promise<string> {
  const created = await app.get(CreateShipmentService).execute({
    merchantId: MERCHANT,

    zone: 'dhaka-metro',
    remoteArea: false,
    fragile: false,
    packagingKind: null,
    sender: { name: 'Simulator', phone: '+8801711111111', line: 'Dhaka' },
    recipient: { name: 'Customer', phone: '+8801822222222', line: 'Chattogram' },
    parcel: { weightGrams: 900, description: `simulation ${scenario}` },
    cod: money(COD_MINOR),
    idempotencyKey: `simulation-${randomUUID()}`,
    actorId: null,
  });
  codes.set(scenario, created.result.trackingCode);
  return created.result.id;
}

async function shipmentIdOf(trackingCode: string): Promise<string> {
  const rows = (await shipmentDs.query(
    `SELECT id FROM shipment.shipments WHERE tracking_code = $1`,
    [trackingCode],
  )) as { id: string }[];
  assert.ok(rows[0], `shipment ${trackingCode} exists`);
  return rows[0].id;
}

async function statusOf(shipmentId: string): Promise<string> {
  const rows = (await shipmentDs.query(`SELECT status FROM shipment.shipments WHERE id = $1`, [
    shipmentId,
  ])) as { status: string }[];
  return rows[0]?.status ?? 'missing';
}

async function trackingTypes(shipmentId: string): Promise<string[]> {
  const rows = (await trackingDs.query(
    `SELECT event_type FROM tracking.events WHERE shipment_id = $1`,
    [shipmentId],
  )) as { event_type: string }[];
  return rows.map((r) => r.event_type);
}

async function outboxTypes(shipmentId: string): Promise<string[]> {
  const rows = (await systemDs.query(
    `SELECT event_type FROM system.outbox_events WHERE aggregate_type = 'shipment' AND aggregate_id = $1`,
    [shipmentId],
  )) as { event_type: string }[];
  return rows.map((r) => r.event_type);
}

describeIfDb('simulation engine — six scenarios', () => {
  before(async () => {
    app = await NestFactory.createApplicationContext(AppModule);
    shipmentDs = app.get<DataSource>('shipmentDataSource');
    systemDs = app.get<DataSource>('systemDataSource');
    trackingDs = app.get<DataSource>('trackingDataSource');
    codDs = app.get<DataSource>('codDataSource');
    returnsDs = app.get<DataSource>('returnsDataSource');
    deliveryDs = app.get<DataSource>('deliveryDataSource');
    for (const scenario of SCENARIOS) {
      if (scenario === 'delivered') continue; // reuses its shipment for the idempotency check
      await newShipment(scenario);
    }
    await newShipment('delivered');
  });

  after(async () => {
    await app?.close();
  });

  test('parseArgs validates before anything boots', () => {
    assert.throws(() => parseArgs([]), /first argument must be "shipment"/);
    assert.throws(() => parseArgs(['shipment']), /tracking code is required/);
    assert.throws(() => parseArgs(['shipment', 'ZP-1', '--scenario', 'bogus']), /--scenario/);
    assert.deepEqual(parseArgs(['shipment', 'ZP-1', '--scenario=lost']), {
      trackingCode: 'ZP-1',
      scenario: 'lost',
    });
    assert.deepEqual(parseArgs(['shipment', 'ZP-1', '--scenario', 'damaged']).scenario, 'damaged');
    assert.equal(SCENARIOS.length, 6);
  });

  test('delivered: full path to DELIVERED with COD collected', async () => {
    const code = codes.get('delivered')!;
    const shipmentId = await shipmentIdOf(code);

    const result = await runSimulation(code, 'delivered', app);
    assert.equal(result.finalStatus, 'DELIVERED');

    const codRows = (await codDs.query(
      `SELECT status, collected_minor FROM cod.records WHERE shipment_id = $1`,
      [shipmentId],
    )) as { status: string; collected_minor: string }[];
    assert.equal(codRows[0]?.status, 'COD_COLLECTED');
    assert.equal(Number(codRows[0]?.collected_minor), COD_MINOR, 'COD collected at full amount');

    const events = await trackingTypes(shipmentId);
    assert.ok(events.includes('DELIVERED'), 'timeline records the delivery');
  });

  test('delivered is idempotent: a re-run reports already-DELIVERED', async () => {
    const code = codes.get('delivered')!;
    const again = await runSimulation(code, 'delivered', app);
    assert.equal(again.finalStatus, 'DELIVERED');
    assert.match(again.steps.join(' | '), /already DELIVERED/);
  });

  test('failed-then-delivered: retryable failure, then success on the retry', async () => {
    const code = codes.get('failed-then-delivered')!;
    const shipmentId = await shipmentIdOf(code);

    const result = await runSimulation(code, 'failed-then-delivered', app);
    assert.equal(result.finalStatus, 'DELIVERED');
    assert.match(
      result.steps.join(' | '),
      /PHONE_UNREACHABLE/,
      'the failure actually happened on the way',
    );

    const attempts = (await deliveryDs.query(
      `SELECT count(*)::int AS n FROM delivery.attempts a
         JOIN delivery.jobs j ON j.id = a.job_id WHERE j.shipment_id = $1`,
      [shipmentId],
    )) as { n: number }[];
    assert.equal(attempts[0]?.n, 1, 'exactly one failed attempt was recorded');
  });

  test('customer-refused: terminal refusal, return initiated', async () => {
    const code = codes.get('customer-refused')!;
    const shipmentId = await shipmentIdOf(code);

    const result = await runSimulation(code, 'customer-refused', app);
    assert.equal(result.finalStatus, 'RETURN_INITIATED');

    const returnRows = (await returnsDs.query(
      `SELECT status FROM returns.requests WHERE shipment_id = $1`,
      [shipmentId],
    )) as { status: string }[];
    assert.equal(returnRows[0]?.status, 'RETURN_INITIATED');
  });

  test('returned: refusal, then custody legs back to the merchant', async () => {
    const code = codes.get('returned')!;
    const shipmentId = await shipmentIdOf(code);

    const result = await runSimulation(code, 'returned', app);
    assert.equal(result.finalStatus, 'RETURNED');

    const returnRows = (await returnsDs.query(
      `SELECT status FROM returns.requests WHERE shipment_id = $1`,
      [shipmentId],
    )) as { status: string }[];
    assert.equal(returnRows[0]?.status, 'RETURNED');
    assert.match(result.steps.join(' | '), /return leg → RETURNED/);
  });

  test('lost: LOST through the machine, exception announced', async () => {
    const code = codes.get('lost')!;
    const shipmentId = await shipmentIdOf(code);

    const result = await runSimulation(code, 'lost', app);
    assert.equal(result.finalStatus, 'LOST');

    const events = await trackingTypes(shipmentId);
    assert.ok(events.includes('EXCEPTION_RAISED'), 'tracking log carries the exception');
    const outbox = await outboxTypes(shipmentId);
    assert.ok(outbox.includes('ShipmentExceptionRaised'), 'outbox announced the exception');
    assert.equal(await statusOf(shipmentId), 'LOST', 'status written through the machine');
  });

  test('damaged: DAMAGED at hub sort, exception announced', async () => {
    const code = codes.get('damaged')!;
    const shipmentId = await shipmentIdOf(code);

    const result = await runSimulation(code, 'damaged', app);
    assert.equal(result.finalStatus, 'DAMAGED');
    assert.match(result.steps.join(' | '), /sort scan at DAC-D/);

    const events = await trackingTypes(shipmentId);
    assert.ok(events.includes('EXCEPTION_RAISED'));
    assert.equal(await statusOf(shipmentId), 'DAMAGED');
  });
});
