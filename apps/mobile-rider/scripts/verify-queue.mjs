/**
 * Stage 4's device half, proven without a phone.
 *
 * Exit check three — "storage is capped and the cap is alerted before it is hit" — is about the
 * queue on the device, and a queue is data, not pixels. So it is driven here directly, against the
 * real server, with an in-memory `QueueStorage` standing in for AsyncStorage.
 *
 * What this deliberately does NOT do: boot Expo, render a screen, or take a screenshot. The app shell
 * is unbuilt and claiming otherwise would be the dishonest kind of proof. What it does prove is the
 * half that can silently lose a rider's day — the sequencing, the cap, and the reconciliation —
 * which is the part no screenshot would ever catch.
 *
 * Run: API_URL=http://localhost:3006 RIDER_KEY_ID=... RIDER_SECRET=... RIDER_ID=...
 *      node apps/mobile-rider/scripts/verify-queue.mjs
 */
import { OfflineQueue, QueueFullError } from '../src/offline/command-queue.ts';
import pg from '../../../apps/backend/node_modules/pg/esm/index.mjs';

const API = process.env.API_URL ?? 'http://localhost:3006';
const KEY_ID = process.env.RIDER_KEY_ID;
const SECRET = process.env.RIDER_SECRET;
const RIDER_ID = process.env.RIDER_ID;

let passed = 0;
const failures = [];
function check(label, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}
function eq(label, actual, expected) {
  check(
    label,
    JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`,
  );
}

/** AsyncStorage's exact two-method shape. Nothing more, so the port cannot rot. */
function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    _raw: map,
  };
}

const scan = (shipmentId, shipmentStatus = 'OUT_FOR_DELIVERY') => ({
  commandType: 'zipzap.rider.delivery',
  payload: { shipmentId },
  expectedState: { shipmentId, shipmentStatus },
});

// ---------------------------------------------------------------- the queue alone
console.log('--- the queue on its own');

const q = new OfflineQueue(memoryStorage(), 100);
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

const first = await q.append(scan(A), new Date('2026-10-09T09:00:00.000Z'));
const second = await q.append(scan(B), new Date('2026-10-09T11:00:00.000Z'));
eq('the first command is sequence 1', first.deviceSequence, 1);
eq('sequences are minted on the device, not the server', second.deviceSequence, 2);

// Appended out of order, sent in order. The queue is a book, not a feed.
const outOfOrder = new OfflineQueue(memoryStorage(), 100);
await outOfOrder.append(scan(B), new Date('2026-10-09T11:00:00.000Z'));
await outOfOrder.append(scan(A), new Date('2026-10-09T09:00:00.000Z'));
// A was appended second but stamped two hours earlier, so it goes first — and carries the HIGHER
// device sequence. Asserting the sequence order here would assert the opposite of the contract: the
// clock decides the order, and the sequence only breaks ties and dedupes.
eq(
  'what goes on the wire is ordered by when it happened, not when it was appended',
  (await outOfOrder.outbound()).map((c) => c.payload.shipmentId),
  [A, B],
);
eq(
  'so an earlier command can carry a later sequence — the clock wins, the counter only breaks ties',
  (await outOfOrder.outbound()).map((c) => c.deviceSequence),
  [2, 1],
);

// Two commands stamped the same instant still have a total order.
const sameInstant = new OfflineQueue(memoryStorage(), 100);
const t = new Date('2026-10-09T09:00:00.000Z');
await sameInstant.append(scan(B), t);
await sameInstant.append(scan(A), t);
eq(
  'a createdAt tie breaks on deviceSequence',
  (await sameInstant.outbound()).map((c) => c.payload.shipmentId),
  [B, A],
);

// A restart must not reissue a sequence — that is the whole dedupe story.
const storage = memoryStorage();
const before = new OfflineQueue(storage, 100);
await before.append(scan(A));
const afterRestart = new OfflineQueue(storage, 100);
const postRestart = await afterRestart.append(scan(B));
eq('a restart does not reuse a device sequence', postRestart.deviceSequence, 2);

// ---------------------------------------------------------------- the cap
console.log('\n--- the cap, and the warning before it');

const capped = new OfflineQueue(memoryStorage(), 10);
eq('the warning threshold is 90% of the cap, matching the server', capped.warningAt, 9);
for (let i = 0; i < 8; i++) await capped.append(scan(A));
eq('no warning while there is room', await capped.capWarning(), false);
await capped.append(scan(A));
eq('warning fires BEFORE the cap, not at it', await capped.capWarning(), true);
eq('and there is still room to work', await capped.remainingCapacity(), 1);
await capped.append(scan(A));
let refused = null;
try {
  await capped.append(scan(A));
} catch (e) {
  refused = e;
}
check(
  'the eleventh is refused, not silently dropped',
  refused instanceof QueueFullError,
  String(refused),
);
eq(
  'and the refusal names the numbers the rider needs',
  refused.message,
  'Offline queue is full (10/10). Find a signal to sync.',
);
eq('the refused command left no trace to later lose', (await capped.pending()).length, 10);

// ---------------------------------------------------------------- reconciliation
console.log('\n--- folding the server`s ruling back in');

const recon = new OfflineQueue(memoryStorage(), 100);
const c1 = await recon.append(scan(A));
const c2 = await recon.append(scan(B));
const c3 = await recon.append(scan(A));

await recon.reconcile([
  { kind: 'applied', deviceSequence: c1.deviceSequence },
  { kind: 'rejected', deviceSequence: c2.deviceSequence, reason: 'shipment is CANCELLED' },
]);
eq(
  'settled commands leave the pending list',
  (await recon.pending()).map((c) => c.deviceSequence),
  [c3.deviceSequence],
);
eq(
  'the rejection reason is kept, because it is the rider`s only clue',
  (await recon.settled()).map((s) => s.kind),
  ['applied', 'rejected'],
);
eq(
  'with the reason intact',
  (await recon.settled()).map((s) => s.reason),
  [undefined, 'shipment is CANCELLED'],
);

// A batch the server refused outright: nothing was ruled on, so nothing may be dropped.
await recon.reconcile([], true);
eq(
  'a cap-refused batch keeps every command for the retry',
  (await recon.pending()).map((c) => c.deviceSequence),
  [c3.deviceSequence],
);

// A `duplicate` for a sequence this queue never minted cannot delete a command it still owes.
await recon.reconcile([{ kind: 'duplicate', deviceSequence: 999, serverSaid: 'already applied' }]);
eq(
  'an unrecognised duplicate does not delete a pending command',
  (await recon.pending()).map((c) => c.deviceSequence),
  [c3.deviceSequence],
);

// A corrupt blob must not brick the app.
const corrupt = new OfflineQueue(memoryStorage({ 'zipzap.rider.offline.v1': '{{{' }), 100);
eq(
  'a corrupt store reads as an empty queue rather than throwing',
  (await corrupt.pending()).length,
  0,
);

// ---------------------------------------------------------------- against the real server
if (!KEY_ID || !SECRET || !RIDER_ID) {
  console.log('\n(skipping the live round trip: set RIDER_KEY_ID, RIDER_SECRET and RIDER_ID)');
} else {
  console.log('\n--- a real day, against the running API');

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const parcelId = process.env.RIDER_PARCEL_ID;
  const staleParcel = process.env.RIDER_STALE_PARCEL_ID;

  const live = new OfflineQueue(memoryStorage(), 100);
  for (let i = 0; i < 12; i++) await live.append(scan(parcelId), new Date(Date.now() + i * 1000));

  const post = async (commands) => {
    const res = await fetch(`${API}/v1/riders/${RIDER_ID}/sync/replay`, {
      method: 'POST',
      headers: { Authorization: `ApiKey ${KEY_ID}.${SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  // No request when there is nothing to say. The server rejects an empty batch with a 400, which is
  // the right contract — but a device that hits it after a successful sync would need a special case
  // for a situation it created itself.
  const send = async () => {
    const commands = await live.outbound();
    if (commands.length === 0) return { status: 0, body: { results: [] }, sent: false };
    return { ...(await post(commands)), sent: true };
  };

  const sent = await send();
  eq('the day goes through', sent.status, 200);
  await live.reconcile(sent.body.results);
  eq('and the device queue empties', (await live.pending()).length, 0);

  // The phone's link dropped after the server applied the batch but before the device heard about
  // it. This is the case deviceSequence exists for.
  const again = await send();
  eq('an emptied queue makes no request at all', again.sent, false);
  eq('and reports nothing to reconcile', again.body.results.length, 0);

  // Re-queue the same work, as a retry of the same day would.
  for (let i = 0; i < 12; i++) await live.append(scan(parcelId), new Date(Date.now() + i * 1000));
  const retry = await send();
  check(
    'a re-queued day comes back as duplicates, not fresh work',
    retry.body.results.every((r) => r.kind === 'duplicate'),
    JSON.stringify(retry.body.results.slice(0, 2)),
  );
  await live.reconcile(retry.body.results);
  eq('and still empties', (await live.pending()).length, 0);

  if (staleParcel) {
    // The rider scanned this one while it was still out for delivery; it was cancelled since.
    //
    // Seeded past the sequences used above, and that is not a convenience: `(rider_id,
    // device_sequence)` is the dedupe key, so reusing sequence 1 here would be the server correctly
    // reporting a *different* command's outcome — a protocol violation by the device, not a bug. A
    // real phone gets this for free because `nextSequence` is persisted and monotonic.
    const stale = new OfflineQueue(
      memoryStorage({
        'zipzap.rider.offline.v1': JSON.stringify({ nextSequence: 5000, pending: [], settled: [] }),
      }),
      100,
    );
    await stale.append(scan(staleParcel, 'OUT_FOR_DELIVERY'));
    const ruled = await post(await stale.outbound());
    eq('the stale scan is refused by the server', ruled.body.results[0].kind, 'rejected');
    check(
      'with a reason the rider can read',
      /CANCELLED/.test(ruled.body.results[0].reason),
      ruled.body.results[0].reason,
    );
    await stale.reconcile(ruled.body.results);
    eq('and the device drops it from pending', (await stale.pending()).length, 0);
    eq(
      'keeping it in the settled list, where the rider can read why',
      (await stale.settled()).length,
      1,
    );
  }

  // The collision, pinned deliberately: the same (rider, sequence) with a DIFFERENT parcel is
  // reported as the earlier command, never applied as the new one. Silently applying it would let a
  // mis-sequenced device deliver the wrong parcel.
  const collide = new OfflineQueue(memoryStorage(), 100);
  await collide.append(scan(staleParcel, 'OUT_FOR_DELIVERY'), new Date(Date.now() - 60000));
  const collided = await post(await collide.outbound());
  check(
    'a reused device sequence is a duplicate of the first command, never the new one applied',
    collided.body.results.every((r) => r.kind === 'duplicate'),
    JSON.stringify(collided.body.results),
  );

  await client.end();
}

console.log(
  failures.length === 0
    ? `\nstage 4 device queue: ${passed} assertions ok`
    : `\n${failures.length} failure(s) of ${passed + failures.length}:\n  ${failures.join('\n  ')}`,
);
process.exit(failures.length === 0 ? 0 : 1);
