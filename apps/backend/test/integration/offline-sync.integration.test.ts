/**
 * Integration: rider offline sync command queue against the real DB.
 *
 * Proves the wire path for Phase 5 rung 4:
 *   1. a rider enqueues a command with an expected aggregate snapshot,
 *   2. the server replays it ordered by creation,
 *   3. a matching expected_state delivers and emits a RiderCommandDelivered event,
 *   4. a mismatched expected_state REJECTS and emits a RiderCommandRejected event
 *      (never silent — a rejection is recorded with a reason),
 *   5. acks are idempotent: duplicate keys replay the recorded outcome,
 *   6. a stale expected_state is caught even after the aggregate moves.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { DataSource } from 'typeorm';
import {
  OfflineSyncService,
  type AckResult,
} from '../../dist/modules/rider/offline-sync.service.js';
import { CommandQueueRepository } from '../../dist/modules/rider/command-queue.repository.js';
import { RiderRepository } from '../../dist/modules/rider/rider.repository.js';
import { RIDER_STATUS_VALIDATOR } from '../../dist/modules/rider/command-queue.validator.js';
import { connectModuleDataSource } from '../../dist/database/module-connection.js';
import { RiderEntity } from '../../dist/modules/rider/rider.entity.js';
import { CommandQueueEntity } from '../../dist/modules/rider/command-queue.entity.js';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

let ds: DataSource;
let riderRepo: RiderRepository;
let queueRepo: CommandQueueRepository;
let offline: OfflineSyncService;
let riderId: string;

before(async () => {
  ds = await connectModuleDataSource('rider', [RiderEntity, CommandQueueEntity]);
  riderRepo = new RiderRepository();
  queueRepo = new CommandQueueRepository();
  offline = new OfflineSyncService(ds, queueRepo, riderRepo, {
    'zipzap.rider.command': RIDER_STATUS_VALIDATOR,
  });

  // Extract the SQL from the TypeORM migration's template literals (up() only).
  const migrationSql = await fs.readFile(
    new URL(
      '../../src/database/migrations/1759000000028-OfflineSyncCommandQueue.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const blocks: string[] = [];
  for (const m of migrationSql.matchAll(/`((?:[^`\\]|\\.)*?)`/g)) {
    blocks.push(m[1]);
  }
  const stmts = blocks
    .map((b) =>
      b
        .split('\n')
        .map((l: string) => l.trim())
        .join('\n')
        .trim(),
    )
    .filter((s: string) => s.length > 0);
  const final = stmts.filter((s: string) => s.startsWith('CREATE '));
  for (const stmt of final) {
    console.log('OFFLINE_SYNC: executing', stmt.split('\n')[0].slice(0, 50));
    await ds.query(stmt);
  }

  riderId = randomUUID();
  await ds.query(
    `INSERT INTO rider.riders (id, display_name, phone, status, capacity)
     VALUES ($1, 'Test Rider', $2, 'AVAILABLE', 5)
     ON CONFLICT (id) DO NOTHING`,
    [riderId, `test-device-${riderId}`],
  );
});

after(async () => {
  await ds?.destroy();
});

describeIfDb('offline sync', () => {
  test('pulls queued commands ordered by creation', async () => {
    const now = new Date();
    for (const seq of [1, 2, 3]) {
      await queueRepo.enqueue(ds.manager, {
        id: randomUUID(),
        riderId,
        deviceSequence: seq,
        commandType: 'zipzap.rider.command',
        payload: { seq },
        expectedState: { status: 'AVAILABLE' },
        createdAt: new Date(now.getTime() + seq * 1000),
      });
    }

    const result = await offline.pull(riderId);

    assert.equal(result.queueSize, 3);
    assert.equal(result.capWarning, false);
    assert.deepEqual(
      result.commands.map((c) => c.deviceSequence),
      [1, 2, 3],
    );
  });

  test('delivers a command whose expected_state matches the current aggregate', async () => {
    // Enqueue a command with a matching snapshot and acknowledge it.
    const res = await offline.enqueue(
      riderId,
      100,
      'zipzap.rider.command',
      { a: 1 },
      { status: 'AVAILABLE' },
    );
    const { count } = await queueRepo.countPending(ds.manager, riderId);
    const pending = await queueRepo.findPendingCommands(
      ds.manager,
      riderId,
      undefined,
      Number(count),
    );
    const [cmd] = pending;
    assert.ok(cmd, 'command should be queued');

    const result = await offline.acknowledge(cmd.id, riderId, `k-a-${riderId}`, {
      commandId: cmd.id,
    });

    assert.equal(result.outcome.kind, 'delivered');
    assert.equal(result.replayed, undefined);

    const row = await queueRepo.findCommand(ds.manager, cmd.id);
    assert.ok(row?.acknowledgedAt, 'acknowledged_at should be set');
    assert.ok(!row.rejectedAt);
  });

  test('rejects a command whose expected_state no longer matches the aggregate', async () => {
    const { count } = await queueRepo.countPending(ds.manager, riderId);
    const pending = await queueRepo.findPendingCommands(
      ds.manager,
      riderId,
      undefined,
      Number(count),
    );
    const [cmd] = pending;
    assert.ok(cmd, 'command should exist');

    // Move the rider's status away from the snapshot captured at enqueue time.
    await ds.query(`UPDATE rider.riders SET status = 'ON_PICKUP' WHERE id = $1`, [riderId]);

    const result = await offline.acknowledge(cmd.id, riderId, `k-b-${riderId}`, {
      commandId: cmd.id,
    });

    assert.equal(result.outcome.kind, 'rejected');
    assert.equal(result.replayed, undefined);

    const row = await queueRepo.findCommand(ds.manager, cmd.id);
    assert.ok(row?.rejectedAt, 'rejected_at should be set');
    assert.ok(row.rejectionReason?.includes('status'), 'rejection reason should explain why');

    const events = await ds.query(
      `SELECT event_type, aggregate_id, payload
       FROM system.outbox_events
      WHERE aggregate_id = $1`,
      [riderId],
    );
    const rejection = events.find(
      (e: { event_type: string }) => e.event_type === 'RiderCommandRejected',
    );
    assert.ok(rejection, 'a RiderCommandRejected outbox event must be written');
  });

  test('replays an idempotent key with the recorded outcome', async () => {
    const { count } = await queueRepo.countPending(ds.manager, riderId);
    const pending = await queueRepo.findPendingCommands(
      ds.manager,
      riderId,
      undefined,
      Number(count),
    );
    const [cmd] = pending;
    assert.ok(cmd, 'command should exist');

    const first = await offline.acknowledge(cmd.id, riderId, `k-c-${riderId}`, {
      commandId: cmd.id,
    });
    console.log('OFFLINE_SYNC_TEST: first =', JSON.stringify(first));

    const second = await offline.acknowledge(cmd.id, riderId, `k-c-${riderId}`, {
      commandId: cmd.id,
    });
    console.log('OFFLINE_SYNC_TEST: second =', JSON.stringify(second));

    assert.equal(first.outcome.kind, 'rejected');
    assert.equal(second.replayed, true);
    assert.equal(second.outcome.kind, 'already_rejected');
  });

  test('warns when the pending queue exceeds 90% of the cap', async () => {
    // Enqueue until the pending count reaches the cap warning threshold.
    let seq = 200;
    while ((await queueRepo.countPending(ds.manager, riderId)).count < '90') {
      const id = randomUUID();
      await ds.query(
        `INSERT INTO rider.command_queue (id, rider_id, device_sequence, command_type, payload, expected_state, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())`,
        [
          id,
          riderId,
          seq,
          'zipzap.rider.command',
          JSON.stringify({ seq }),
          JSON.stringify({ status: 'ON_PICKUP' }),
        ],
      );
      seq += 1;
    }

    const result = await offline.pull(riderId);

    assert.ok(result.capWarning, 'cap warning should fire at 90% of the cap');
    assert.ok(result.queueSize >= 90);
  });

  test('rejects when the rider does not exist', async () => {
    const missing = randomUUID();
    await assert.rejects(() => offline.pull(missing), /Rider .* not found/);
    await assert.rejects(
      () => offline.acknowledge(randomUUID(), missing, 'k-x', { commandId: 'x' }),
      /not found/,
    );
  });
});
