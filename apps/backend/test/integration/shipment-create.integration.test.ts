/**
 * Integration: real Postgres, real transactions.
 *
 * These import from `dist/`, not `src/`, for two reasons. node:test cannot load decorators, so
 * `@Injectable()` classes are unloadable from source. And a test that exercises the compiled
 * artifact is testing what production actually runs.
 *
 * These are the tests that prove the architecture composes rather than merely existing. A mock
 * cannot test that a transaction rolls back, that a unique constraint resolves a race, or that a
 * trigger rejects an UPDATE — which is exactly what these assert.
 *
 * Needs a real database. Skipped, not failed, when DATABASE_URL is absent, so `pnpm test` stays
 * runnable with no infrastructure.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { money } from '../../dist/common/money.js';
import { CreateShipmentService } from '../../dist/modules/shipment/create-shipment.service.js';
import { ShipmentRepository } from '../../dist/modules/shipment/shipment.repository.js';
import { AppendTrackingEventService } from '../../dist/modules/tracking/append-tracking-event.service.js';
import { PricingService } from '../../dist/modules/pricing/pricing.service.js';
import { PricingRepository } from '../../dist/modules/pricing/pricing.repository.js';
import { PricingVersionEntity } from '../../dist/modules/pricing/pricing-version.entity.js';
import { EnsureCodRecordService } from '../../dist/modules/cod/ensure-cod-record.service.js';
import { CodRecordEntity } from '../../dist/modules/cod/cod-record.entity.js';
import { NetworkService } from '../../dist/modules/network/network.service.js';
import { ServiceAreaEntity } from '../../dist/modules/network/service-area.entity.js';
import { connectModuleDataSource } from '../../dist/database/module-connection.js';
import { ShipmentEntity } from '../../dist/modules/shipment/shipment.entity.js';
import { PublicTimelineEntity } from '../../dist/modules/tracking/public-timeline.entity.js';
import { TrackingEventEntity } from '../../dist/modules/tracking/tracking-event.entity.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

let shipmentDb: DataSource;
let trackingDb: DataSource;
let systemDb: DataSource;
let pricingDb: DataSource;
let codDb: DataSource;
let networkDb: DataSource;
let service: CreateShipmentService;

const command = (key: string) => ({
  merchantId: randomUUID(),
  merchantPlan: 'standard',
  zone: 'dhaka-metro',
  remoteArea: false,
  fragile: false,
  packagingKind: null as string | null,
  sender: { name: 'Ayesha', phone: '+8801700000000', line: 'Dhaka' },
  recipient: { name: 'Rahim', phone: '+8801800000000', line: 'Chattogram' },
  parcel: { weightGrams: 1200, description: 'Two shirts' },
  cod: money(125_050),
  idempotencyKey: key,
  actorId: null,
});

before(async () => {
  if (!databaseUrl) return;
  shipmentDb = await connectModuleDataSource('shipment', [ShipmentEntity]);
  trackingDb = await connectModuleDataSource('tracking', [
    TrackingEventEntity,
    PublicTimelineEntity,
  ]);
  systemDb = await connectModuleDataSource('system', []);
  pricingDb = await connectModuleDataSource('pricing', [PricingVersionEntity]);
  codDb = await connectModuleDataSource('cod', [CodRecordEntity]);
  networkDb = await connectModuleDataSource('network', [ServiceAreaEntity]);

  service = new CreateShipmentService(
    shipmentDb,
    new ShipmentRepository(),
    new AppendTrackingEventService(),
    new PricingService(pricingDb, new PricingRepository()),
    new EnsureCodRecordService(codDb),
    new NetworkService(networkDb),
  );
});

after(async () => {
  await shipmentDb?.destroy();
  await trackingDb?.destroy();
  await systemDb?.destroy();
  await pricingDb?.destroy();
  await codDb?.destroy();
  await networkDb?.destroy();
});

describeIfDb('CreateShipment — one transaction, four writes', () => {
  test('writes shipment, tracking event, outbox row and idempotency key together', async () => {
    const input = command(`key-${randomUUID()}`);
    const { result, replayed } = await service.execute(input);

    assert.equal(replayed, false);
    assert.equal(result.status, 'CREATED');
    assert.match(result.trackingCode, /^ZP-[0-9A-HJKMNP-TV-Z]{10}$/);
    // COD survived as integer minor units, not a float.
    assert.equal(result.cod.amountMinor, 125_050);

    const shipments = await shipmentDb.query('SELECT * FROM shipment.shipments WHERE id = $1', [
      result.id,
    ]);
    assert.equal(shipments.length, 1);
    assert.equal(shipments[0].cod_amount_minor, 125_050);
    assert.equal(shipments[0].status, 'CREATED');

    const events = await trackingDb.query('SELECT * FROM tracking.events WHERE shipment_id = $1', [
      result.id,
    ]);
    assert.equal(events.length, 1, 'the tracking event is written in the same transaction');
    assert.equal(events[0].event_type, 'SHIPMENT_CREATED');

    const outbox = await systemDb.query(
      'SELECT * FROM system.outbox_events WHERE aggregate_id = $1 AND published_at IS NULL',
      [result.id],
    );
    assert.equal(outbox.length, 1, 'the outbox row is written in the same transaction');
    assert.equal(outbox[0].event_type, 'ShipmentCreated');

    const keys = await systemDb.query(
      'SELECT * FROM system.idempotency_keys WHERE idempotency_key = $1',
      [input.idempotencyKey],
    );
    assert.equal(keys.length, 1, 'and so is the idempotency key');
  });

  test('a failure after the aggregate insert rolls back everything', async () => {
    const input = command(`key-${randomUUID()}`);

    // Force a failure after the aggregate is inserted but before commit. This is the test the
    // architecture lives or dies by.
    const exploding = Object.create(CreateShipmentService.prototype) as CreateShipmentService;
    Object.assign(exploding, {
      shipmentDataSource: shipmentDb,
      shipments: new ShipmentRepository(),
      pricing: {
        quote: async () => ({
          version: 1,
          currency: 'BDT',
          lines: [],
          total: { amountMinor: 0, currency: 'BDT' },
        }),
      },
      cod: { ensure: async () => 'cod-stub-id' },
      network: {
        checkZone: async () => ({
          zone: input.zone,
          serviceable: true,
          reason: null,
          estimatedDays: 1,
          pickupAvailable: true,
          deliveryAvailable: true,
          codAvailable: true,
        }),
      },
      tracking: {
        append: async () => {
          throw new Error('simulated failure after the aggregate insert');
        },
      },
    });

    await assert.rejects(() => exploding.execute(input), /simulated failure/);

    const shipments = await shipmentDb.query(
      'SELECT * FROM shipment.shipments WHERE merchant_id = $1',
      [input.merchantId],
    );
    assert.equal(shipments.length, 0, 'the shipment insert must roll back');

    const keys = await systemDb.query(
      'SELECT * FROM system.idempotency_keys WHERE idempotency_key = $1',
      [input.idempotencyKey],
    );
    assert.equal(keys.length, 0, 'the idempotency key must roll back with the work it guards');

    // Nothing was published either, because nothing was committed.
    const outbox = await systemDb.query(
      `SELECT * FROM system.outbox_events WHERE payload->>'merchantId' = $1`,
      [input.merchantId],
    );
    assert.equal(outbox.length, 0, 'and no outbox row survives a rolled-back transaction');
  });
});

describeIfDb('Idempotency', () => {
  test('replaying the same key returns the original response and creates no second shipment', async () => {
    const input = command(`key-${randomUUID()}`);

    const first = await service.execute(input);
    const second = await service.execute(input);

    assert.equal(second.replayed, true);
    assert.deepEqual(second.result, first.result, 'the original response is replayed verbatim');

    const rows = await shipmentDb.query(
      'SELECT id FROM shipment.shipments WHERE merchant_id = $1',
      [input.merchantId],
    );
    assert.equal(rows.length, 1, 'exactly one shipment');
  });

  test('the same key with a different body is rejected', async () => {
    const key = `key-${randomUUID()}`;
    const original = command(key);
    await service.execute(original);

    // Same key AND same merchant — only the body differs. Deriving from `original` matters:
    // rebuilding the command would mint a new merchantId and scope the key differently, so the
    // request would be legitimate rather than a violation.
    const tampered = { ...original, parcel: { weightGrams: 9999, description: 'Something else' } };
    await assert.rejects(() => service.execute(tampered), /different request body/);

    // And nothing was created by the rejected attempt.
    const rows = await shipmentDb.query(
      'SELECT id FROM shipment.shipments WHERE merchant_id = $1',
      [original.merchantId],
    );
    assert.equal(rows.length, 1);
  });

  test('concurrent requests with one key create exactly one shipment', async () => {
    const input = command(`race-${randomUUID()}`);

    // The unique constraint is the concurrency control, not a check-then-insert.
    const results = await Promise.allSettled([
      service.execute(input),
      service.execute(input),
      service.execute(input),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    assert.ok(fulfilled.length >= 1, 'at least one request must succeed');

    const ids = fulfilled.map(
      (r) => (r as PromiseFulfilledResult<{ result: { id: string } }>).value.result.id,
    );
    assert.equal(new Set(ids).size, 1, 'every successful response is the same shipment');

    const rows = await shipmentDb.query(
      'SELECT id FROM shipment.shipments WHERE merchant_id = $1',
      [input.merchantId],
    );
    assert.equal(rows.length, 1, 'the race produced one shipment, not three');
  });

  test('a different merchant using the same key string is a different request', async () => {
    const key = `shared-${randomUUID()}`;
    const mine = command(key);
    const theirs = { ...command(key), merchantId: randomUUID() };

    const a = await service.execute(mine);
    const b = await service.execute(theirs);

    assert.equal(a.replayed, false);
    assert.equal(b.replayed, false, 'one merchant must never see another merchant response');
    assert.notEqual(a.result.id, b.result.id);
  });
});

describeIfDb('serviceability — coverage rows answer, before any write', () => {
  test('a zone with no coverage row is rejected with a reason', async () => {
    const input = { ...command(`key-${randomUUID()}`), zone: 'atlantis-01' };

    await assert.rejects(
      () => service.execute(input),
      (error: Error) => error.message.includes('No coverage for zone "atlantis-01"'),
    );

    const shipments = await shipmentDb.query(
      'SELECT id FROM shipment.shipments WHERE merchant_id = $1',
      [input.merchantId],
    );
    assert.equal(shipments.length, 0, 'the rejection wrote nothing');

    // Same key, valid zone: the claim rolled back with the rejection, so the key
    // is not burned by a request that never happened.
    const retry = await service.execute({ ...input, zone: 'dhaka-metro' });
    assert.equal(retry.replayed, false);
    assert.equal(retry.result.status, 'CREATED');
  });

  test('a covered zone creates normally — the seeded row is the policy', async () => {
    const rows = await networkDb.query(
      `SELECT zone, serviceable, estimated_days FROM network.service_areas WHERE zone = 'dhaka-metro'`,
    );
    assert.equal(rows.length, 1, 'dhaka-metro coverage exists as data, not as code');
    assert.equal(rows[0].serviceable, true);
    assert.equal(rows[0].estimated_days, 1);

    const { result } = await service.execute({ ...command(`key-${randomUUID()}`) });
    assert.equal(result.status, 'CREATED');
  });
});

describeIfDb('tracking.events is append-only', () => {
  test('UPDATE is rejected by the database', async () => {
    const { result } = await service.execute(command(`key-${randomUUID()}`));

    await assert.rejects(
      () =>
        trackingDb.query('UPDATE tracking.events SET event_type = $2 WHERE shipment_id = $1', [
          result.id,
          'DELIVERED',
        ]),
      /append-only/,
    );
  });

  test('DELETE is rejected by the database', async () => {
    const { result } = await service.execute(command(`key-${randomUUID()}`));

    await assert.rejects(
      () => trackingDb.query('DELETE FROM tracking.events WHERE shipment_id = $1', [result.id]),
      /append-only/,
    );
  });
});

describeIfDb('module boundaries — what is actually enforced', () => {
  test('an unqualified name cannot escape the module schema', async () => {
    // The connection sets search_path to the module's schema, so `merchants` does not resolve.
    // This is real runtime enforcement.
    await assert.rejects(
      () => shipmentDb.query('SELECT count(*) FROM merchants'),
      /does not exist/,
    );
  });

  test("the module's own schema is reachable", async () => {
    const rows = await shipmentDb.query('SELECT count(*)::int AS n FROM shipment.shipments');
    assert.equal(typeof rows[0].n, 'number');
  });

  test('a QUALIFIED cross-schema name IS still permitted by the database', async () => {
    // Recorded deliberately, because the opposite was previously claimed in ADR-0002 and in a
    // comment in module-connection.ts. Both were wrong and both were found by running the query
    // instead of reasoning about it.
    //
    // search_path cannot block a fully-qualified name. Closing this at the database needs a
    // Postgres role per module and a separate connection credential per module; TypeORM merges
    // `extra` into its own Pool so a pre-built pool with a connect hook is not an option.
    // Until then `scripts/check-boundaries.mjs` is the gate, and it runs in CI and in
    // `pnpm verify`.
    const attempt = await shipmentDb.query('SELECT count(*) FROM merchant.merchants').then(
      () => 'permitted',
      () => 'refused',
    );

    assert.equal(attempt, 'permitted', 'if this ever becomes refused, remove the ADR caveat');
  });

  test('the boundary checker does catch a qualified cross-module query', async () => {
    // The CI gate is the enforcement for qualified access, so it is worth asserting it fires.
    const { execFileSync } = await import('node:child_process');
    const checker = new URL('../../../../scripts/check-boundaries.mjs', import.meta.url).pathname;

    const source = new URL('../../src/modules/shipment/__boundary-probe.ts', import.meta.url)
      .pathname;

    const { writeFileSync, mkdirSync, rmSync } = await import('node:fs');
    mkdirSync(new URL('../../src/modules/shipment/application', import.meta.url).pathname, {
      recursive: true,
    });
    writeFileSync(source, 'export const probe = `SELECT * FROM merchant.merchants`;\n');

    try {
      let failed = false;
      try {
        execFileSync(process.execPath, [checker], { stdio: 'pipe' });
      } catch {
        failed = true; // non-zero exit is the expected outcome
      }
      assert.equal(failed, true, 'the boundary checker must exit non-zero on a violation');
    } finally {
      rmSync(source, { force: true });
    }
  });

  test('no cross-schema foreign keys exist', async () => {
    const rows = await trackingDb.query(`
      SELECT c.conname, cn.nspname AS referenced_schema
        FROM pg_constraint c
        JOIN pg_class cr ON cr.oid = c.confrelid
        JOIN pg_namespace cn ON cn.oid = cr.relnamespace
       WHERE c.contype = 'f' AND c.connamespace = 'tracking'::regnamespace
    `);
    assert.equal(rows.length, 0, 'cross-module references are identifiers, not constraints');
  });
});
