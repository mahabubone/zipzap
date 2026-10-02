/**
 * Nest-managed wrapper around the outbox drain loop.
 *
 * Injected wherever the publisher is needed. `start()` is idempotent so the publisher
 * entrypoint and any future scheduled trigger cannot accidentally run two loops.
 */

import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { connectNats, drainQuietly } from '../../nats';
import { OutboxPublisher } from './outbox.publisher';

@Injectable()
export class OutboxPublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private publisher: OutboxPublisher | undefined;

  constructor(@InjectDataSource('system') private readonly dataSource: DataSource) {}

  async start(): Promise<void> {
    if (this.publisher) return;
    const { nc, js } = await connectNats('zipzap-publisher');
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
