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
import { Redis } from 'ioredis';
import http from 'node:http';
import { AppModule } from './app.module.ts';
import { config } from './config';
import { registry, registerProcessMetrics } from './common/metrics';
import { connectNats, drainQuietly, watchConnection } from './nats.ts';
import { TrackingConsumer } from './modules/tracking/tracking.consumer.ts';
import { FinanceConsumer } from './modules/finance/finance-consumer.service.ts';
import { WebhookConsumer } from './modules/merchant/webhook.consumer.ts';
import { NotificationConsumer } from './modules/notification/notification.consumer.ts';
import { AnalyticsConsumer } from './modules/analytics/analytics.consumer.ts';
import { SUBSCRIPTIONS } from './subscriptions.ts';
import { eventDuplicateTotal, incEventConsumed, registerQueueClient } from './common/metrics';

const logger = new Logger('worker');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();

  const { nc } = await connectNats('zipzap-worker');

  // Queue depth is surfaced on /metrics; a shared client keeps scrapes cheap.
  const redisClient = new Redis(config().redisUrl, { maxRetriesPerRequest: null });
  registerQueueClient(redisClient);

  // The second /metrics entrypoint — a lean metrics-only HTTP server on its own
  // port, since the worker has no other HTTP surface.
  registerProcessMetrics();
  const metricsServer = http.createServer(async (req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': registry.contentType });
    res.end(await registry.metrics());
  });
  metricsServer.listen(config().metricsPort, () => {
    logger.log(`metrics listening on :${config().metricsPort}`);
  });

  const tracking = app.get(TrackingConsumer);
  const finance = app.get(FinanceConsumer);
  const webhook = app.get(WebhookConsumer);
  const notification = app.get(NotificationConsumer);
  const analytics = app.get(AnalyticsConsumer);

  const handlers = { tracking, finance, webhook, notification, analytics } as const;

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

  // A worker that cannot reach its broker is not a worker. It stays alive, its metrics keep
  // answering 200, and it consumes nothing — so it exits instead, and says why on the way out.
  // `shutdown()` is not used here: this is not a drain, and pretending it was would mark the
  // connection as deliberately closing and suppress the log line that explains the restart.
  watchConnection(nc, (reason) => {
    logger.error(`${reason} — exiting so the process supervisor can restart this worker`);
    void app.close().finally(() => process.exit(1));
  });

  logger.log('worker started');

  await Promise.all(
    open.map(async (subscription, index) => {
      const consumer = SUBSCRIPTIONS[index]!.consumer;
      for await (const message of subscription) {
        const subject = message.subject;
        try {
          const outcome = await handlers[consumer].handle({
            subject: subject,
            payload: message.data,
          });
          incEventConsumed(consumer, subject, outcome);
          if (outcome === 'duplicate') eventDuplicateTotal.labels({ consumer }).inc();
          if (outcome === 'processed') {
            logger.debug({ subject: message.subject }, 'event processed');
          }
        } catch (failure) {
          incEventConsumed(consumer, subject, 'error');
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
