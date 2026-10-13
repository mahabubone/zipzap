/**
 * Verification test for RiderClient offline-to-online lifecycle.
 */
import assert from 'node:assert/strict';
import { RiderClient } from '../src/rider-client.ts';

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
  };
}

console.log('--- RiderClient offline queue lifecycle');

const storage = memoryStorage();
const rider = new RiderClient(
  storage,
  { riderId: 'rider-42', apiKey: 'test.secret' },
  'http://localhost:3000',
);

// 1. Record delivery offline
const cmd1 = await rider.recordDelivery('ship-101');
assert.equal(cmd1.deviceSequence, 1);
assert.equal(cmd1.commandType, 'zipzap.rider.delivery');

// 2. Record pickup offline
const cmd2 = await rider.recordPickup('pickup-202', 'ship-102');
assert.equal(cmd2.deviceSequence, 2);

const pending = await rider.queue.pending();
assert.equal(pending.length, 2, 'two commands are queued locally');

// 3. Mock replay response and verify reconciliation
let replayPayloadSent = null;
rider.client.replayRiderSync = async (riderId, commands) => {
  replayPayloadSent = { riderId, commands };
  return {
    results: [
      { deviceSequence: 1, commandId: 'c-1', kind: 'applied', reason: null },
      { deviceSequence: 2, commandId: 'c-2', kind: 'rejected', reason: 'pickup cancelled' },
    ],
    queueSize: 0,
    capWarning: false,
  };
};

const syncOutcome = await rider.sync();
assert.equal(syncOutcome.sent, 2);
assert.equal(syncOutcome.queueRemaining, 0, 'queue drained after sync');
assert.equal(syncOutcome.settled.length, 2);
assert.equal(syncOutcome.settled[0].kind, 'applied');
assert.equal(syncOutcome.settled[1].kind, 'rejected');
assert.equal(syncOutcome.settled[1].reason, 'pickup cancelled');

assert.equal(replayPayloadSent.riderId, 'rider-42');
assert.equal(replayPayloadSent.commands.length, 2);
assert.equal(replayPayloadSent.commands[0].deviceSequence, 1);
assert.equal(replayPayloadSent.commands[1].deviceSequence, 2);

console.log('PASS RiderClient offline-to-online sync lifecycle proven');
