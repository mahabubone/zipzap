/**
 * Entrypoint 2 of 3 — the worker.
 *
 * Runs BullMQ workers and NATS consumers. Scales with work volume.
 *
 * `ponytail:` no BullMQ queues yet — they arrive with the first real job. NATS consumers
 * land with the first domain event. Registering an empty queue framework now proves
 * nothing and adds a Redis dependency to boot.
 */

import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { connectNats, drainQuietly } from './nats';

async function bootstrap(): Promise<void> {
  // Keeps the Nest container alive so domain modules register their consumers as they are added.
  await NestFactory.createApplicationContext(AppModule);

  const { nc } = await connectNats('zipzap-worker');
  new Logger('worker').log('worker started — no consumers registered yet');

  const shutdown = async (): Promise<void> => {
    await drainQuietly(nc);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

bootstrap().catch((error: unknown) => {
  new Logger('worker').error(error);
  process.exit(1);
});
