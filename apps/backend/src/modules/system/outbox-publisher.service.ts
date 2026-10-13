/**
 * Nest-managed wrapper around the outbox drain loop.
 *
 * Injected wherever the publisher is needed. `start()` is idempotent so the publisher
 * entrypoint and any future scheduled trigger cannot accidentally run two loops.
 */

import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { connectNats, drainQuietly, watchConnection } from '../../nats';
import { OutboxPublisher } from './outbox.publisher';

@Injectable()
export class OutboxPublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private publisher: OutboxPublisher | undefined;

  constructor(@InjectDataSource('system') private readonly dataSource: DataSource) {}

  async start(): Promise<void> {
    if (this.publisher) return;
    const { nc, js } = await connectNats('zipzap-publisher');
    // Same reasoning as the worker's, and the same failure without it: a publisher that has lost the
    // broker publishes nothing, so every mutation in the system keeps succeeding and its event
    // accumulates in the outbox. Nothing about that looks like a fault from the outside — the API is
    // green, the queue is draining, the events are simply arriving late, forever.
    //
    // It is fatal here for a second reason: `publish()` would throw on a closed connection and, being
    // inside a drain loop with its own catch, that throw would be logged as a per-batch error while the
    // loop kept spinning against a dead socket.
    watchConnection(nc, (reason) => {
      this.logger.error(`${reason} — the outbox will grow without bound until this restarts`);
      process.exit(1);
    });
    this.publisher = new OutboxPublisher(this.dataSource, nc, js);
    this.publisher.start();
    this.logger.log('outbox publisher started');
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.publisher) return;
    await this.publisher.stop();
    await drainQuietly(this.publisher.connection);
  }
}
