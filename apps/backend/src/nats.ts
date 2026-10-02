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

export async function drainQuietly(nc: NatsConnection): Promise<void> {
  await nc.drain().catch(() => undefined);
}
