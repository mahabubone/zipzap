/**
 * Entrypoint 3 of 3 — the outbox publisher.
 *
 * The only process permitted to publish to NATS. Scales with event rate.
 * See docs/architecture/eventing.md.
 */

import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import http from 'node:http';
import { AppModule } from './app.module';
import { OutboxPublisherService } from './modules/system/outbox-publisher.service';
import { config } from './config';
import { registry, registerProcessMetrics } from './common/metrics';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();

  // The third /metrics entrypoint — the publisher is a background process with
  // no other HTTP surface, so it hosts its own lean metrics server.
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
  metricsServer.listen(config().publisherMetricsPort, () => {
    new Logger('publisher').log(`metrics listening on :${config().publisherMetricsPort}`);
  });

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
