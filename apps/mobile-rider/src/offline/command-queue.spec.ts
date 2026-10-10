/**
 * The offline command queue's invariants, as tests the CI actually runs.
 *
 * These were the offline half of `scripts/verify-queue.mjs`, a standalone script that called
 * `process.exit(1)` on a failure and was never wired into `pnpm test` — so a break in the queue's
 * core guarantees was invisible to everyone except whoever remembered to run it by hand.
 *
 * The assertions themselves are carried over unchanged. What is new is that they now fail a build.
 * The first two set up the queue with a fake storage, so the port also drops the script's habit of
 * reaching into a sibling package's `node_modules` for a dependency.
 *
 * Rule 3 applies to these tests as it does to the file under test: no React Native, no Expo. The
 * queue takes a `QueueStorage` port, and a Map satisfies it.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  OfflineQueue,
  QueueFullError,
  type QueueState,
  type QueueStorage,
  type Settled,
} from './command-queue.ts';

class MemoryStorage implements QueueStorage {
  private readonly store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

/** One of the payloads the rider app actually queues. */
function deliveryCommand(sequence: number) {
  return {
    commandType: 'zipzap.rider.delivery',
    payload: { shipmentId: `shp-${sequence}` },
    expectedState: { shipmentId: `shp-${sequence}`, shipmentStatus: 'OUT_FOR_DELIVERY' },
  };
}

describe('OfflineQueue', () => {
  let storage: MemoryStorage;
  let queue: OfflineQueue;

  beforeEach(() => {
    storage = new MemoryStorage();
    queue = new OfflineQueue(storage);
  });

  describe('deviceSequence', () => {
    it('is monotonic across restarts — the restart is a new queue, backed by the same storage', async () => {
      await queue.append(deliveryCommand(1));
      await queue.append(deliveryCommand(2));

      // A new queue over the same store is what a cold start looks like.
      const restarted = new OfflineQueue(storage);
      const third = await restarted.append(deliveryCommand(3));

      expect(third.deviceSequence).toBe(3);
      expect((await restarted.pending()).map((c) => c.deviceSequence)).toEqual([1, 2, 3]);
    });

    it('is never reused, even after every command has been ruled on', async () => {
      // The dedupe key halves are (deviceSequence, rider). If a sequence were minted again after a
      // sync, the server would treat a new command as a replay of the old one — the failure mode
      // rule 1 of the queue exists for.
      const first = await queue.append(deliveryCommand(1));
      const second = await queue.append(deliveryCommand(2));
      await queue.reconcile([
        { kind: 'applied', deviceSequence: first.deviceSequence },
        { kind: 'applied', deviceSequence: second.deviceSequence },
      ]);

      expect(await queue.pending()).toEqual([]);
      const third = await queue.append(deliveryCommand(3));
      expect(third.deviceSequence).toBe(3);
      expect(second.deviceSequence).not.toBe(third.deviceSequence);
    });
  });

  describe('reconcile', () => {
    it('keeps a rejection reason, because that is the rider’s only clue', async () => {
      // A rejection is not an error to swallow. "Why didn't my scan count" has exactly one answer,
      // and it is the `reason` the server recorded.
      await queue.append(deliveryCommand(1));
      await queue.reconcile([
        { kind: 'rejected', deviceSequence: 1, reason: 'Shipment was cancelled.' },
      ]);

      const settled = await queue.settled();
      expect(settled).toEqual([
        { kind: 'rejected', deviceSequence: 1, reason: 'Shipment was cancelled.' },
      ]);
      expect(await queue.pending()).toEqual([]);
    });

    it('does not drop an unrejected command', async () => {
      // A partial ruling must leave the rest queued: the server ruled on one command and the other
      // is still outbound.
      const one = await queue.append(deliveryCommand(1));
      await queue.append(deliveryCommand(2));
      await queue.reconcile([{ kind: 'applied', deviceSequence: one.deviceSequence }]);

      const remaining = await queue.pending();
      expect(remaining.map((c) => c.deviceSequence)).toEqual([2]);
    });

    it('is idempotent: re-ruling on the same command changes nothing', async () => {
      // Exactly what happens on a retry after a lost response, and why replay is safe by
      // construction rather than by careful coordination.
      await queue.append(deliveryCommand(1));
      await queue.reconcile([{ kind: 'applied', deviceSequence: 1 }]);
      await queue.reconcile([{ kind: 'applied', deviceSequence: 1 }]);

      const settled = await queue.settled();
      expect(settled.filter((s) => s.deviceSequence === 1)).toHaveLength(1);
    });
  });

  describe('the cap', () => {
    it('warns before it bites', async () => {
      // ADR-0012's stated consequence: storage grows unboundedly if a device stays offline. The
      // warning is what turns that into something the rider can act on.
      const cap = 4;
      const small = new OfflineQueue(storage, cap);
      for (let i = 0; i < 3; i += 1) await small.append(deliveryCommand(i));

      expect(await small.capWarning()).toBe(true);
    });

    it('refuses rather than dropping at the cap', async () => {
      // The safe direction. Losing a scan the rider was told was accepted is far worse than
      // refusing the hundred-and-first.
      const cap = 3;
      const small = new OfflineQueue(storage, cap);
      for (let i = 0; i < cap; i += 1) await small.append(deliveryCommand(i));

      await expect(small.append(deliveryCommand(cap))).rejects.toThrow(QueueFullError);
      await small.append(deliveryCommand(cap + 1)).then(
        () => expect.unreachable('a queued command must not raise QueueFullError at the cap'),
        (error) => {
          expect(error).toBeInstanceOf(QueueFullError);
          expect((error as QueueFullError).size).toBe(cap);
        },
      );
    });
  });

  describe('a corrupt store', () => {
    it('starts empty rather than throwing on unparseable JSON', async () => {
      // A device whose storage was truncated mid-write must boot, not crash-loop. An offline queue
      // that cannot load is a rider who cannot work.
      await storage.setItem('zipzap.rider.offline.v1', 'not json at all');
      const fresh = new OfflineQueue(storage);

      expect(await fresh.pending()).toEqual([]);
    });

    it('survives a state that is valid JSON but the wrong shape', async () => {
      const wrongShape: unknown = { nextSequence: 'one', pending: 'nope' };
      await storage.setItem('zipzap.rider.offline.v1', JSON.stringify(wrongShape));
      const fresh = new OfflineQueue(storage);

      expect(await fresh.pending()).toEqual([]);
    });
  });

  describe('the persisted shape', () => {
    it('keeps the sequence counter in the same write as the command', async () => {
      // One write, not two: a crash between them would mint a sequence the store never saw, and
      // reuse one on the next boot. That is the whole of rule 1.
      await queue.append(deliveryCommand(1));
      const persisted = JSON.parse(
        (await storage.getItem('zipzap.rider.offline.v1')) ?? 'null',
      ) as QueueState;

      expect(persisted.nextSequence).toBe(2);
      expect(persisted.pending).toHaveLength(1);
    });
  });
});

/** Type-level check that the queue accepts the port a real storage would implement. */
describe('QueueStorage', () => {
  it('is satisfied by a Map-backed store', async () => {
    const store = new MemoryStorage();
    const queue = new OfflineQueue(store);
    const settled: readonly Settled[] = [];
    expect(settled).toEqual([]);
    expect(await queue.settled()).toEqual([]);
  });
});
