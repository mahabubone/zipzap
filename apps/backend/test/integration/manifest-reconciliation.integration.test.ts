/**
 * Integration: the manifest lifecycle and the reconciliation exception,
 * against real Postgres. Skipped, not failed, when DATABASE_URL is absent.
 *
 * The box under test (Phase 2 exit gate): "A manifest missing a shipment
 * raises an exception at reconciliation." Everything else here exists to make
 * that assertion honest — the lifecycle that leads to RECEIVED, the append-only
 * cargo list, the outbox event that only fires when reconciliation passes, and
 * the retry that succeeds once the parcel arrives.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { connectModuleDataSource } from '../../dist/database/module-connection.js';
import { ManifestService } from '../../dist/modules/network/manifest.service.js';
import { ShipmentLookup } from '../../dist/modules/shipment/shipment.lookup.js';
import { ShipmentRepository } from '../../dist/modules/shipment/shipment.repository.js';
import { ShipmentEntity } from '../../dist/modules/shipment/shipment.entity.js';
import { ResourceNotFoundError } from '../../dist/common/domain-error.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

let networkDb: DataSource;
let shipmentDb: DataSource;
let manifests: ManifestService;

/** Raw insert: tests write fixture rows in another module's schema deliberately. */
async function insertShipment(status: string): Promise<string> {
  const id = randomUUID();
  await shipmentDb.query(
    `INSERT INTO shipment.shipments
       (id, tracking_code, merchant_id, sender_name, sender_phone, sender_address,
        recipient_name, recipient_phone, recipient_address, parcel_weight_grams,
        parcel_description, cod_amount_minor, cod_currency, status, pricing_version)
     VALUES ($1, $2, $3, 'T', '+8801700000000', 'Dhaka', 'R', '+8801800000000', 'CGP',
             1000, 'fixture', 0, 'BDT', $4, 1)`,
    [id, `ZP-FIX${id.slice(0, 8).toUpperCase()}`, randomUUID(), status],
  );
  return id;
}

async function manifestStatus(id: string): Promise<string> {
  const rows = (await networkDb.query(`SELECT status FROM network.manifests WHERE id = $1`, [
    id,
  ])) as { status: string }[];
  return rows[0]?.status ?? 'missing';
}

async function setShipmentStatus(id: string, status: string): Promise<void> {
  await shipmentDb.query(`UPDATE shipment.shipments SET status = $2 WHERE id = $1`, [id, status]);
}

before(async () => {
  if (!databaseUrl) return;
  networkDb = await connectModuleDataSource('network', []);
  shipmentDb = await connectModuleDataSource('shipment', [ShipmentEntity]);
  manifests = new ManifestService(
    networkDb,
    new ShipmentLookup(shipmentDb, new ShipmentRepository()),
  );
});

after(async () => {
  await networkDb?.destroy();
  await shipmentDb?.destroy();
});

describeIfDb('route topology — the seeded fixed network', () => {
  test('two routes, three legs each, every leg resolving to a real hub', async () => {
    const routes = (await networkDb.query(`SELECT id, code FROM network.routes`)) as {
      id: string;
      code: string;
    }[];
    assert.deepEqual(
      routes.map((r) => r.code).sort(),
      ['DAC-CGP-LH', 'DAC-SYL-LH'],
      'fixed topology, seeded by migration 0026',
    );

    const legs = (await networkDb.query(`
      SELECT l.sequence, l.mode, f.code AS from_code, t.code AS to_code
        FROM network.route_legs l
        JOIN network.routes r ON r.id = l.route_id
        JOIN hub.hubs f ON f.id = l.from_hub_id
        JOIN hub.hubs t ON t.id = l.to_hub_id
       WHERE r.code = 'DAC-CGP-LH'
       ORDER BY l.sequence
    `)) as { sequence: number; mode: string; from_code: string; to_code: string }[];
    assert.deepEqual(
      legs.map((l) => [l.sequence, l.from_code, l.to_code, l.mode]),
      [
        [1, 'DAC-D', 'DAC-R', 'LOCAL'],
        [2, 'DAC-R', 'CGP-R', 'LINEHAUL'],
        [3, 'CGP-R', 'CGP-D', 'LAST_MILE'],
      ],
    );
  });

  test('hubs carry a real geography point', async () => {
    const rows = (await networkDb.query(`
      SELECT code, ST_Distance(
        location,
        ST_SetSRID(ST_Point(90.4125, 23.8103), 4326)::geography
      ) AS metres
      FROM hub.hubs WHERE code = 'DAC-R'
    `)) as { metres: string }[];
    assert.ok(Number(rows[0]?.metres) < 50, 'DAC-R sits on its seeded coordinate');
  });
});

describeIfDb('manifest lifecycle — lock, assert, save, outbox', () => {
  test('DRAFT → SEALED → DISPATCHED → RECEIVED → RECONCILED with all cargo arrived', async () => {
    const { tripId } = await manifests.scheduleTrip('DAC-CGP-LH');
    const a = await insertShipment('IN_TRANSIT');
    const b = await insertShipment('IN_TRANSIT');

    const manifest = await manifests.createManifest(tripId, [a, b]);
    assert.equal(manifest.status, 'DRAFT');

    assert.equal((await manifests.seal(manifest.id)).status, 'SEALED');
    assert.equal((await manifests.dispatch(manifest.id)).status, 'DISPATCHED');
    assert.equal((await manifests.receive(manifest.id)).status, 'RECEIVED');

    await setShipmentStatus(a, 'AT_DESTINATION_HUB');
    await setShipmentStatus(b, 'DELIVERED');

    const reconciled = await manifests.reconcile(manifest.id);
    assert.equal(reconciled.status, 'RECONCILED');

    const events = await networkDb.query(
      `SELECT event_type FROM system.outbox_events WHERE aggregate_id = $1 ORDER BY id`,
      [manifest.id],
    );
    const types = (events as { event_type: string }[]).map((row) => row.event_type);
    assert.deepEqual(types, [
      'ManifestCreated',
      'ManifestSealed',
      'ManifestDispatched',
      'ManifestReceived',
      'ManifestReconciled',
    ]);
  });

  test('a manifest missing a shipment raises an exception — and retries once it arrives', async () => {
    const { tripId } = await manifests.scheduleTrip('DAC-CGP-LH');
    const arrived = await insertShipment('AT_DESTINATION_HUB');
    const stillMoving = await insertShipment('IN_TRANSIT');
    const manifest = await manifests.createManifest(tripId, [arrived, stillMoving]);

    await manifests.seal(manifest.id);
    await manifests.dispatch(manifest.id);
    await manifests.receive(manifest.id);

    const failure = await manifests
      .reconcile(manifest.id)
      .catch((error: unknown) => error as Error);
    assert.equal((failure as { code?: string }).code, 'MANIFEST_INCOMPLETE');
    assert.ok(
      (failure as Error).message.includes(stillMoving),
      'the exception names the missing shipment',
    );
    assert.equal(await manifestStatus(manifest.id), 'RECEIVED', 'status did not move in silence');

    const events = await networkDb.query(
      `SELECT count(*)::int AS n FROM system.outbox_events WHERE aggregate_id = $1`,
      [manifest.id],
    );
    assert.equal((events as { n: number }[])[0]?.n, 4, 'no ManifestReconciled event was written');

    await setShipmentStatus(stillMoving, 'AT_DESTINATION_HUB');
    const retried = await manifests.reconcile(manifest.id);
    assert.equal(retried.status, 'RECONCILED', 'the same call passes once the parcel arrives');
  });

  test('reconciliation is unreachable before RECEIVED', async () => {
    const { tripId } = await manifests.scheduleTrip('DAC-SYL-LH');
    const shipment = await insertShipment('AT_DESTINATION_HUB');
    const manifest = await manifests.createManifest(tripId, [shipment]);

    const failure = await manifests
      .reconcile(manifest.id)
      .catch((error: unknown) => error as Error);
    assert.match((failure as Error).message, /Cannot move from DRAFT to RECONCILED/);
  });

  test('an unknown manifest is a 404, not a crash', async () => {
    await assert.rejects(
      () => manifests.seal(randomUUID()),
      (error: Error) => error instanceof ResourceNotFoundError,
    );
  });

  test('the cargo list is append-only — DELETE is rejected by the database', async () => {
    const { tripId } = await manifests.scheduleTrip('DAC-CGP-LH');
    const shipment = await insertShipment('IN_TRANSIT');
    const manifest = await manifests.createManifest(tripId, [shipment]);

    await assert.rejects(
      () =>
        networkDb.query(`DELETE FROM network.manifest_items WHERE manifest_id = $1`, [manifest.id]),
      /append-only/,
    );
  });
});
