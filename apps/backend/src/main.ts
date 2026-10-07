/**
 * Entrypoint 1 of 3 — the HTTP API.
 *
 * Serves HTTP, validates, dispatches use cases. Scales with request rate.
 * See docs/architecture/overview.md#why-three-entrypoints.
 */

import type { Request, Response, NextFunction } from 'express';
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/exception.filter';
import { config } from './config';
import {
  registry,
  httpRequestsTotal,
  httpRequestDuration,
  registerProcessMetrics,
} from './common/metrics';

async function bootstrap(): Promise<void> {
  const { port, isProduction } = config();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  // Bulk CSV uploads ride inside JSON (the CSV text is what matters, not its
  // transport encoding). A 10,000-row file is ~850KB — the default 100KB JSON
  // limit would reject it before validation runs. 10MB covers the exit gate;
  // the DTO still caps `csv` at 10M chars.
  // Instrument the registry with bounded process metrics (Node runtime, GC,
  // event loop). This is a hard dependency, not an opt-in: /metrics must work.
  registerProcessMetrics();

  // Global HTTP instrumentation: route template (never a concrete path with an
  // id), method and status. The /metrics scrape endpoint is excluded so it does
  // not pollute its own counters.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.url === '/metrics') return next();
    const start = Date.now();
    res.on('finish', () => {
      const route = req.route?.path ?? `${req.baseUrl}${req.path}`;
      httpRequestsTotal.labels(route, req.method, String(res.statusCode)).inc();
      httpRequestDuration.labels(route).observe((Date.now() - start) / 1000);
    });
    next();
  });

  app.useBodyParser('json', { limit: '10mb' });

  // The single place a domain error becomes an HTTP response.
  app.useGlobalFilters(new DomainExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );

  if (!isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('ZipZap API')
        .setDescription(
          'Logistics operating system for e-commerce fulfillment and last-mile delivery.',
        )
        .setVersion('1.0')
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  // Prometheus scrape endpoint — the first of three /metrics entrypoints.
  app.use('/metrics', async (_req: Request, res: Response) => {
    res.type('text/plain');
    res.send(await registry.metrics());
  });

  app.enableShutdownHooks();
  // Browsers need CORS; the API is also called server-to-server where CORS is
  // irrelevant. WEB_ORIGIN pins the allowed origins in production; true
  // reflects any origin for local dev only.
  app.enableCors({ origin: process.env.WEB_ORIGIN ? process.env.WEB_ORIGIN.split(',') : true });
  await app.listen(port);
  new Logger('main').log(`api listening on :${port}`);
}

bootstrap().catch((error: unknown) => {
  new Logger('main').error(error);
  process.exit(1);
});
