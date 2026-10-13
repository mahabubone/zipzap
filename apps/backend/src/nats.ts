/**
 * NATS JetStream connection and stream setup.
 *
 * NATS says what happened. It is not a source of truth — if it is down, mutations keep
 * succeeding and the outbox accumulates (ADR-0005, ADR-0006).
 *
 * `ponytail:` `js.streams` only exposes `get()`. Creating a stream goes through
 * `jetstreamManager().streams.add()`. And `js.publish` takes `Uint8Array | string`, not an
 * object — the envelope is serialised here.
 */

import {
  DiscardPolicy,
  Events,
  RetentionPolicy,
  StorageType,
  connect,
  type JetStreamClient,
  type NatsConnection,
} from 'nats';
import { config } from './config';

export interface NatsHandle {
  readonly nc: NatsConnection;
  readonly js: JetStreamClient;
}

export async function connectNats(name: string): Promise<NatsHandle> {
  const { natsUrl, natsStream } = config();
  const nc = await connect({ servers: natsUrl, name });

  const js = nc.jetstream();
  const jsm = await js.jetstreamManager();
  await jsm.streams
    .add({
      name: natsStream,
      subjects: ['zipzap.>'],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      discard: DiscardPolicy.Old,
    })
    .catch(() => {
      /* stream already exists — fine, this is the normal path after the first boot */
    });

  return { nc, js };
}

/** Set while this process is shutting down on purpose, so `close` is not read as a failure. */
const draining = new WeakSet<NatsConnection>();

/**
 * Report what the broker connection is doing, and say so when it stops.
 *
 * ## Why this exists
 *
 * `connect()` defaults to 60 reconnect attempts at two seconds' wait. After the last one the client
 * gives up: the socket closes, the status iterator **ends**, and — with nothing listening — no process
 * anywhere learns that. The worker stays alive, its `/metrics` endpoint keeps answering, a health
 * check keeps returning 200, and it consumes no events ever again.
 *
 * That is the worst of the three states, because it is indistinguishable from health by every signal
 * an operator has. And it has a twin that is easy to confuse with it: a worker that is simply **not
 * running** looks exactly the same from the outside — no events moving, a green dashboard, a fixture
 * script waiting on a settlement that can never be frozen. Both were chased during the work that added
 * this, and the distance between them turned out to be one log line.
 *
 * So every transition is logged, and an *unexpected* end is fatal: the worker exits non-zero, a
 * supervisor restarts it, and the events are still in the stream — which is exactly why a wedged
 * worker is worse than a restarted one.
 *
 * The deliberate-shutdown path is marked by `drainQuietly`, so a `SIGTERM` does not read as a fault
 * and does not turn a clean deploy into a non-zero exit.
 */
export function watchConnection(nc: NatsConnection, onFatal: (reason: string) => void): void {
  // Fire and forget: the status iterator lives as long as the connection does, and blocking on it
  // would stop the worker from ever subscribing. `nats.js` 2.x reports transitions through this async
  // iterator rather than an event emitter, so this is also the only way to see them.
  //
  // The important detail is what happens when the iterator **ends**. There is no "close" event in
  // 2.x — the loop simply completes, and that *is* the close. A connection that has exhausted its
  // reconnect attempts ends the iteration; so does a `drain()`. The two are told apart by the
  // `draining` marker, which is the difference between a deploy and an outage.
  void (async () => {
    try {
      for await (const status of nc.status()) {
        switch (status.type) {
          case Events.Disconnect:
            warn(`broker connection lost (${describeServer(nc)}); retrying`);
            break;
          case Events.Reconnect:
            warn(`reconnected to ${describeServer(nc)}`);
            break;
          case Events.Error:
            // The client's own errors — permissions, protocol, a server error response. Not all of
            // them are fatal, so this reports rather than exits.
            warn(`broker reported an error: ${String(status.data ?? 'no detail')}`);
            break;
          default:
            // `Connect`, `Update`, `LDM` and the debug events are all handled by the client's own
            // reconnection logic. Nothing here should try to outvote it.
            break;
        }
      }
    } catch (error) {
      // The iterator itself throwing is another way to end up here, and it is still fatal.
      if (draining.has(nc)) return;
      reportFatal(onFatal, `broker status stream ended in an error: ${String(error)}`);
      return;
    }

    if (draining.has(nc)) return;
    reportFatal(
      onFatal,
      'broker connection closed and the client exhausted its reconnect attempts',
    );
  })();
}

function reportFatal(onFatal: (reason: string) => void, reason: string): void {
  console.error(`[nats] ${reason}`);
  try {
    onFatal(reason);
  } catch (error) {
    // The handler is the caller's — in both processes it closes the app and exits, and both can fail.
    // Letting that rejection escape would surface as an *unhandled rejection*, which Node terminates
    // the process for: a healthy worker killed by a bug in the path that only runs when the broker is
    // already gone, with a stack trace pointing at the wrong thing.
    console.error(`[nats] the fatal handler itself failed: ${String(error)}`);
    process.exit(1);
  }
}

function describeServer(nc: NatsConnection): string {
  try {
    return nc.getServer() ?? 'an unknown server';
  } catch {
    // `getServer()` throws on a closed connection, which is exactly the moment this is called.
    return 'the broker (address unavailable — the connection is already closed)';
  }
}

function warn(message: string): void {
  console.warn(`[nats] ${message}`);
}

export async function drainQuietly(nc: NatsConnection): Promise<void> {
  draining.add(nc);
  await nc.drain().catch(() => undefined);
}
