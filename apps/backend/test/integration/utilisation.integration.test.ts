/**
 * Integration: rider utilisation KPI against the real DB.
 *
 * Phase 5 rung 5 — utilisation measured, then optimised. Proves the KPI surface returns
 * observable, correct numbers over the live `riders` table: per-rider load factor and the
 * pool-wide view across all ASSIGNABLE riders.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { RiderEntity } from '../../dist/modules/rider/rider.entity.js';
import { RegisterRiderService } from '../../dist/modules/rider/register-rider.service.js';
import { connectModuleDataSource } from '../../dist/database/module-connection.js';
import { UtilisationService } from '../../dist/modules/rider/utilisation.service.js';
import { AssignRiderService } from '../../dist/modules/rider/assign-rider.service.js';
import { RiderRepository } from '../../dist/modules/rider/rider.repository.js';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

// Unique prefix for this test run so rider phones never collide with other suites or prior runs.
const POOL_PREFIX = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');

let ds: DataSource;
let register: RegisterRiderService;
let assign: AssignRiderService;
let util: UtilisationService;
let riders: RiderRepository;
let riderIds: string[] = [];

before(async () => {
  ds = await connectModuleDataSource('rider', [RiderEntity]);
  // Isolate this suite: the live DB is shared by all integration tests, so clear stale riders
  // from any prior run before building the fresh pool. Sequential concurrency makes this safe.
  await ds.query('DELETE FROM rider.riders');

  register = new RegisterRiderService(ds, new RiderRepository());
  assign = new AssignRiderService(ds, new RiderRepository());
  util = new UtilisationService(ds, new RiderRepository());
  riders = new RiderRepository();

  for (let i = 0; i < 6; i++) {
    const cap = i % 3 === 0 ? 2 : 3;
    const phone = `+88017${POOL_PREFIX}${String(i).padStart(3, '0')}`;
    const r = await register.execute({
      displayName: `Rider ${i}`,
      phone: phone,
      capacity: cap,
    });
    riderIds.push(r.id);
  }
});

after(async () => {
  await ds?.destroy();
});

describeIfDb('utilisation KPI', () => {
  test('pool-utilisation reports all assignable riders', async () => {
    const pool = await util.getPoolLoad();
    const assignable = await riders.findAssignable(ds.manager);
    assert.equal(
      pool.totalCapacity,
      assignable.reduce((s, r) => s + r.capacity, 0),
      'total capacity matches assignable pool',
    );
    assert.equal(pool.inUseCapacity, 0, 'no jobs assigned yet');
    assert.equal(pool.loadFactor, 0);
    assert.equal(pool.meanLoadFactor, 0);
    assert.equal(pool.maxLoadFactor, 0);
    assert.equal(pool.minLoadFactor, 0);
  });

  test('pool-utilisation reflects assignments (before/after record)', async () => {
    const before = await util.getPoolLoad();
    assert.ok(before.maxLoadFactor === 0);

    // Assign one job to the first rider.
    const assigned = await assign.assign({
      jobId: randomUUID(),
      candidates: [
        {
          riderId: riderIds[0],
          distanceMetres: 1000,
          activeJobs: 0,
          capacity: 3,
          recentRefusals: 0,
        },
        {
          riderId: riderIds[1],
          distanceMetres: 2000,
          activeJobs: 0,
          capacity: 3,
          recentRefusals: 0,
        },
      ],
    });

    // Before/after is recorded on the assignment result.
    assert.equal(assigned.poolLoadBefore.maxLoadFactor, 0);
    assert.equal(assigned.chosenLoadFactorAfter, 1 / 3);

    const after = await util.getPoolLoad();
    // Capacity now in use = 1 job; pool load rises.
    assert.ok(after.inUseCapacity >= 1, 'at least one job in use');
    assert.ok(after.maxLoadFactor > before.maxLoadFactor, 'max load factor rose after assignment');
    assert.ok(
      after.meanLoadFactor > before.meanLoadFactor,
      'mean load factor rose after assignment',
    );
  });

  test('rider-utilisation returns null for unknown rider', async () => {
    const load = await util.getRiderLoad('nonexistent-rider');
    assert.equal(load, null);
  });

  test('rider-utilisation returns correct load factor', async () => {
    // riderIds[0] was assigned a job by the previous test; use riderIds[1] which is still idle.
    const [r1] = riderIds.slice(1);
    const load = await util.getRiderLoad(r1);
    assert.ok(load);
    assert.equal(load.riderId, r1);
    assert.equal(load.activeJobs, 0);
    assert.equal(load.loadFactor, 0);
  });
});
