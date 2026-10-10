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
import { SwaggerModule } from '@nestjs/swagger';
import { dump } from 'js-yaml';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/exception.filter';
import { requestIdMiddleware } from './common/request-id.middleware';
import { buildDocument } from './openapi';
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

  // Every request gets a correlation id BEFORE the instrumentation, so a slow or failed request is
  // findable by the same id the client was given. Registered first deliberately.
  app.use(requestIdMiddleware);

  // Global HTTP instrumentation: route template (never a concrete path with an
  // id), method and status. The /metrics scrape endpoint is excluded so it does
  // not pollute its own counters.
  app.use((req: Request & { requestId?: string }, res: Response, next: NextFunction) => {
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

  // The contract is served always, not just in development: /docs-json and /docs-yaml are the
  // machine-readable copy of the API that generated clients and CI are built from, and gate the
  // interactive UI instead. Withholding the JSON in production made the committed spec and the
  // live server describe different APIs, and there is no longer any way for them to diverge.
  const document = buildDocument(app);
  app.use('/docs-json', (_req: Request, res: Response) => {
    res.type('application/json').send(JSON.stringify(document));
  });
  app.use('/docs-yaml', (_req: Request, res: Response) => {
    res.type('application/yaml').send(dump(document, { lineWidth: 100, noRefs: false }));
  });
  // The interactive UI stays out of production: it is a debugger, not an interface.
  if (!isProduction) {
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
