import { describe, expect, test, vi } from 'vitest';
import { drainQuietly, watchConnection } from './nats.ts';

/**
 * A process that cannot reach its broker must not be able to look healthy.
 *
 * `connect()` gives up after 60 reconnect attempts, and nothing listened for that: the worker would
 * stay alive, keep answering `/metrics`, keep its health check at 200, and consume nothing, with
 * nothing in its log. Which is indistinguishable, from outside, from a worker that is not running at
 * all — the pair of them cost twenty minutes of a stalled fixture before anyone could tell them apart.
 *
 * These tests are about *who gets told*. `nats.js` 2.x has no "close" event: the status iterator
 * simply **ends**, and that ending is the signal — so the fakes feed statuses through a real async
 * iterable and assert on what the loop does when it completes.
 */

type Status = { type: string; data?: string | number };

/** The slice of `NatsConnection` that `watchConnection` and `drainQuietly` touch. */
function fakeConnection(statuses: readonly Status[] = []) {
  let drained = false;
  let consumed = 0;
  return {
    /** Yields the scripted statuses, then ends — which is how a closed connection looks. */
    status: async function* () {
      for (const status of statuses) {
        consumed++;
        yield status;
      }
    },
    getServer: () => ('drained' in { drained } ? undefined : 'nats://localhost:4224'),
    drain: async () => {
      drained = true;
    },
    wasDrained: () => drained,
    consumed: () => consumed,
  };
}

type Fake = ReturnType<typeof fakeConnection>;

/** Let the fire-and-forget watcher run its loop to completion. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('watchConnection', () => {
  test('the iterator ending without a drain is fatal', async () => {
    // The whole point. The worker process must learn that it can no longer do its job.
    const nc = fakeConnection();
    const fatal: string[] = [];
    watchConnection(nc as never, (reason) => fatal.push(reason));

    await settle();
    expect(fatal).toHaveLength(1);
    expect(fatal[0]).toMatch(/exhausted its reconnect attempts/);
  });

  test('a disconnect is not fatal — the client is still trying', async () => {
    // Sixty reconnect attempts is two minutes of a broker restarting, which a worker should ride out.
    // Exiting on the first blip would turn a five-second deployment into a restart loop.
    const nc = fakeConnection([{ type: 'disconnect' }, { type: 'disconnect' }]);
    const fatal: string[] = [];
    watchConnection(nc as never, (reason) => fatal.push(reason));

    await settle();
    // Two disconnects were consumed…
    expect(nc.consumed()).toBe(2);
    // …and then the connection ended, which is the one fatal thing.
    expect(fatal).toHaveLength(1);
    expect(fatal[0]).toMatch(/exhausted/);
  });

  test('a reconnect is not itself fatal, and the watcher keeps reading', async () => {
    const nc = fakeConnection([{ type: 'disconnect' }, { type: 'reconnect' }, { type: 'error' }]);
    const fatal: string[] = [];
    watchConnection(nc as never, (reason) => fatal.push(reason));

    await settle();
    // All three transitions were observed before the ending, so nothing was missed on the way out.
    expect(nc.consumed()).toBe(3);
    expect(fatal).toHaveLength(1);
    expect(fatal[0]).not.toMatch(/error/);
  });

  test('a broker error alone never ends the process while the connection lives', async () => {
    // Not every error from a NATS client ends the connection — a permissions error on one publish
    // does not. So an error must be reported without becoming the fatal signal.
    const nc = fakeConnection([{ type: 'error', data: 'permissions violation' }]);
    const fatal: string[] = [];
    watchConnection(nc as never, (reason) => fatal.push(reason));

    await settle();
    // The only fatal reported is the *ending*, not the error.
    expect(fatal).toEqual([
      'broker connection closed and the client exhausted its reconnect attempts',
    ]);
  });

  test('a deliberate drain ends the iteration without being fatal', async () => {
    // `drainQuietly` marks the connection first. Without that, every `SIGTERM` during a deploy would
    // exit non-zero, and a restart policy would read a normal stop as a crash — which is how a deploy
    // turns into an outage loop.
    const nc = fakeConnection([{ type: 'disconnect' }, { type: 'reconnect' }]);
    const fatal: string[] = [];
    watchConnection(nc as never, (reason) => fatal.push(reason));

    await drainQuietly(nc as never);
    expect(nc.wasDrained()).toBe(true);
    await settle();
    expect(fatal).toHaveLength(0);
  });

  test('a throwing iterator is fatal too', async () => {
    // Another way to reach the same place. Losing the reason in a rejected promise is how this went
    // unnoticed in the first place.
    const nc = {
      status: async function* () {
        yield { type: 'disconnect' } as Status;
        throw new Error('socket hang up');
      },
      getServer: () => 'nats://localhost:4224',
      drain: async () => {},
    };
    const fatal: string[] = [];
    watchConnection(nc as never, (reason) => fatal.push(reason));

    await settle();
    expect(fatal).toHaveLength(1);
    expect(fatal[0]).toMatch(/socket hang up/);
  });

  test('a drain after the throwing path still suppresses the fatal', async () => {
    const nc = {
      status: async function* () {
        throw new Error('socket hang up');
      },
      getServer: () => undefined,
      drain: async () => {},
    };
    const fatal: string[] = [];
    watchConnection(nc as never, (reason) => fatal.push(reason));

    await drainQuietly(nc as never);
    await settle();
    expect(fatal).toHaveLength(0);
  });

  test('a drained connection does not make a dying one look intentional', async () => {
    // The marker is keyed by connection. A publisher that drained cleanly must not be able to stand
    // down a worker that lost its broker.
    const worker = fakeConnection();
    const publisher = fakeConnection();
    const workerFatal: string[] = [];
    const publisherFatal: string[] = [];

    watchConnection(worker as never, (reason) => workerFatal.push(reason));
    watchConnection(publisher as never, (reason) => publisherFatal.push(reason));
    await drainQuietly(publisher as never);
    await settle();

    expect(workerFatal).toHaveLength(1);
    expect(publisherFatal).toHaveLength(0);
  });

  test('a fatal handler that throws still ends the process, rather than escaping as a rejection', async () => {
    // It is fire-and-forget inside a promise. If the handler's rejection escaped, Node would report an
    // *unhandled rejection* and terminate the process anyway — with a stack trace pointing at the
    // caller's bug rather than at the dead broker, on a worker that was healthy until the broker went.
    const exits: number[] = [];
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exits.push(code ?? 0);
      return undefined as never;
    }) as never);
    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message: unknown) => {
      errors.push(String(message));
    });

    try {
      const nc: Fake = fakeConnection();
      watchConnection(nc as never, () => {
        throw new Error('app.close() rejected');
      });
      await settle();

      expect(exits).toEqual([1]);
      expect(errors.some((line) => line.includes('fatal handler itself failed'))).toBe(true);
    } finally {
      exit.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
