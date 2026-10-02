/**
 * Entrypoint 3 of 3 — the outbox publisher.
 *
 * The only process permitted to publish to NATS. Scales with event rate.
 * See docs/architecture/eventing.md.
 */

import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { OutboxPublisherService } from './modules/system/outbox-publisher.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();

  await app.get(OutboxPublisherService).start();
  new Logger('publisher').log('outbox publisher draining');

  const shutdown = (): void => process.exit(0);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((error: unknown) => {
  new Logger('publisher').error(error);
  process.exit(1);
});
