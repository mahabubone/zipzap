/**
 * Reliability drills — docs/operations/reliability.md, as executable tests.
 *
 * Every row of the dependency matrix that CAN be asserted in-process is
 * asserted here. Rows that need a killed process (worker down, publisher
 * down), a dead broker, or a second process are stated as decisions, not
 * faked. Faked drills are worse than no drills: a test that invents its
 * failure proves the fixture, not the system.
 *
 * Needs real Postgres and real Redis. Skipped, not failed, when
 * DATABASE_URL is absent.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { money } from '../../dist/common/money.js';
import { CreateShipmentService } from '../../dist/modules/shipment/create-shipment.service.js';
import { ShipmentRepository } from '../../dist/modules/shipment/shipment.repository.js';
import { AppendTrackingEventService } from '../../dist/modules/tracking/append-tracking-event.service.js';
import { EnsureCodRecordService } from '../../dist/modules/cod/ensure-cod-record.service.js';
import { CodRecordEntity } from '../../dist/modules/cod/cod-record.entity.js';
import { NetworkService } from '../../dist/modules/network/network.service.js';
import { ServiceAreaEntity } from '../../dist/modules/network/service-area.entity.js';
import { connectModuleDataSource } from '../../dist/database/module-connection.js';
import { buildPricingService } from './harness.ts';
import { ShipmentEntity } from '../../dist/modules/shipment/shipment.entity.js';
import { TrackingEventEntity } from '../../dist/modules/tracking/tracking-event.entity.js';
import { PublicTimelineEntity } from '../../dist/modules/tracking/public-timeline.entity.js';
import { consumeOnce } from '../../dist/modules/system/consume-once.js';
import { isDependencyFailure } from '../../dist/common/exception.filter.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6381';
const describeIfDb = databaseUrl ? describe : describe.skip;

let shipmentDb: DataSource;
let trackingDb: DataSource;
let systemDb: DataSource;
let pricing: Awaited<ReturnType<typeof buildPricingService>>;
let codDb: DataSource;
let networkDb: DataSource;
let service: CreateShipmentService;

const command = () => ({
  merchantId: randomUUID(),

  zone: 'dhaka-metro',
  remoteArea: false,
  fragile: false,
  packagingKind: null as string | null,
  sender: { name: 'Ayesha', phone: '+8801700000000', line: 'Dhaka' },
  recipient: { name: 'Rahim', phone: '+8801800000000', line: 'Chattogram' },
  parcel: { weightGrams: 900, description: 'Drill parcel' },
  cod: money(50_000),
  idempotencyKey: `drill-${randomUUID()}`,
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
  pricing = await buildPricingService();
  codDb = await connectModuleDataSource('cod', [CodRecordEntity]);
  networkDb = await connectModuleDataSource('network', [ServiceAreaEntity]);

  service = new CreateShipmentService(
    shipmentDb,
    new ShipmentRepository(),
    new AppendTrackingEventService(),
    pricing.service,
    new EnsureCodRecordService(codDb),
    new NetworkService(networkDb),
  );
});

after(async () => {
  await shipmentDb?.destroy();
  await trackingDb?.destroy();
  await systemDb?.destroy();
  await pricing?.db.destroy();
  await pricing?.merchantDb.destroy();
  await codDb?.destroy();
  await networkDb?.destroy();
});

describeIfDb('NATS down: mutations succeed, the outbox accumulates', () => {
  test('a shipment create writes its row and leaves the event unpublished', async () => {
    // No publisher process is running in this test: this IS the NATS-down
    // condition. The mutation must commit, and the event must wait, not fail.
    const input = command();
    const { result } = await service.execute(input);

    const outbox = await systemDb.query(
      `SELECT published_at, attempts FROM system.outbox_events
        WHERE aggregate_type = 'shipment' AND aggregate_id = $1`,
      [result.id],
    );
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].published_at, null, 'unpublished: no publisher can deliver it');
    assert.equal(outbox[0].attempts, 0, 'never attempted a publish');
  });
});

describeIfDb('Duplicate event: the dedupe claim is atomic with the work', () => {
  test('the same consumer + event id processes once and no-ops on redelivery', async () => {
    let runs = 0;
    const consumer = `drill-${randomUUID()}`;
    const eventId = `evt-${randomUUID()}`;

    const first = await consumeOnce(systemDb, consumer, eventId, async () => {
      runs += 1;
    });
    const second = await consumeOnce(systemDb, consumer, eventId, async () => {
      runs += 1;
    });

    assert.equal(first, 'processed');
    assert.equal(second, 'duplicate');
    assert.equal(runs, 1, 'the work ran exactly once across two deliveries');
  });

  test('a throwing handler rolls back the claim, so the event is retryable', async () => {
    const consumer = `drill-${randomUUID()}`;
    const eventId = `evt-${randomUUID()}`;

    await assert.rejects(
      consumeOnce(systemDb, consumer, eventId, async () => {
        throw new Error('downstream exploded');
      }),
      /downstream exploded/,
    );

    const retry = await consumeOnce(systemDb, consumer, eventId, async () => undefined);
    assert.equal(retry, 'processed', 'retry is not mistaken for a duplicate');
  });
});

describeIfDb('Postgres down: the failure is a dependency failure, never a 500 lie', () => {
  test('a dead server produces an error the filter maps to 503', async () => {
    const dead = new DataSource({
      type: 'postgres',
      url: databaseUrl!.replace(/:\d+\//, ':59999/'),
      migrations: [],
    });
    await dead.initialize().catch(() => undefined);
    const error = await dead.query('SELECT 1').catch((e: unknown) => e);
    await dead.destroy().catch(() => undefined);

    assert.ok(isDependencyFailure(error), `expected a dependency failure, got: ${String(error)}`);
  });
});

describeIfDb('Worker down: the job waits in Redis, never lost, never partial', () => {
  test('a queued BullMQ job persists with no worker consuming it', async () => {
    const { Queue } = await import('bullmq');
    const parsed = new URL(redisUrl);
    const queue = new Queue(`drill-${randomUUID()}`, {
      connection: { host: parsed.hostname, port: Number(parsed.port || 6379) },
    });

    const job = await queue.add('ship-it', { parcel: randomUUID() });
    const waiting = await queue.getWaitingCount();

    assert.equal(waiting, 1);
    const stored = await queue.getJob(job.id!);
    assert.equal(stored?.data.parcel, job.data.parcel, 'the payload survives intact');

    await queue.obliterate({ force: true });
    await queue.close();
  });
});
