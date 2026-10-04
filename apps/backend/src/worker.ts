/**
 * Entrypoint 2 of 3 — the worker.
 *
 * Subscribes to the event stream and runs consumers. Scales with work volume.
 *
 * The subscription loop lives here because subscribing is infrastructure, while the handler in
 * each consumer is domain-aware and unit tested without NATS.
 *
 * Core NATS subscriptions, not JetStream consumers: the outbox is at-least-once by design and the
 * dedupe lives in system.consumed_events. See docs/architecture/eventing.md.
 */

import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import { connectNats, drainQuietly } from './nats.ts';
import { TrackingConsumer } from './modules/tracking/tracking.consumer.ts';
import { FinanceConsumer } from './modules/finance/finance-consumer.service.ts';

const logger = new Logger('worker');

const SUBSCRIPTIONS = [
  { consumer: 'tracking', subject: 'zipzap.shipment.created' },
  { consumer: 'tracking', subject: 'zipzap.pickup.requested' },
  { consumer: 'tracking', subject: 'zipzap.pickup.assigned' },
  { consumer: 'tracking', subject: 'zipzap.delivery.out_for_delivery' },
  { consumer: 'tracking', subject: 'zipzap.delivery.attempted' },
  { consumer: 'tracking', subject: 'zipzap.delivery.completed' },
  { consumer: 'tracking', subject: 'zipzap.cod.collected' },
  { consumer: 'finance', subject: 'zipzap.cod.collected' },
  { consumer: 'finance', subject: 'zipzap.cod.partial_collection' },
] as const;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();

  const { nc } = await connectNats('zipzap-worker');
  const tracking = app.get(TrackingConsumer);
  const finance = app.get(FinanceConsumer);

  const handlers = { tracking, finance } as const;

  const open = SUBSCRIPTIONS.map(({ consumer, subject }) => {
    const subscription = nc.subscribe(subject, { queue: consumer });
    logger.log(`subscribed ${consumer} to ${subject}`);
    return subscription;
  });

  const shutdown = async (): Promise<void> => {
    await drainQuietly(nc);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  logger.log('worker started');

  await Promise.all(
    open.map(async (subscription, index) => {
      const handler = handlers[SUBSCRIPTIONS[index]!.consumer];
      for await (const message of subscription) {
        try {
          const outcome = await handler.handle({
            subject: message.subject,
            payload: message.data,
          });
          if (outcome === 'processed') {
            logger.debug({ subject: message.subject }, 'event processed');
          }
        } catch (failure) {
          // Log and continue. Throwing out of this loop tears down the subscription and
          // silently stops processing, which is the failure mode a consumer must never have.
          logger.error({ err: failure, subject: message.subject }, 'consumer handler failed');
        }
      }
    }),
  );
}

bootstrap().catch((error: unknown) => {
  logger.error(error);
  process.exit(1);
});
