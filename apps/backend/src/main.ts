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

  // CORS, now that the consoles speak same-origin.
  //
  // This used to be `origin: true` — reflect whatever the caller sent — which is an allowlist of
  // one, maintained by the attacker. Combined with no credentials support it was not exploitable
  // for reading, but it let any site send a preflighted request the server would answer, and it
  // is the kind of default that becomes a breach the day someone adds `credentials: true`.
  //
  // The web apps now proxy /api to this server, so the browser sends no cross-origin request at
  // all and CORS has nothing to do for them. What it covers is the remaining case: a caller that
  // is not behind one of our proxies (a server integration, or a developer with curl) and any
  // future deployment where a console is served from a different origin.
  //
  // `credentials: true` is NOT set, deliberately. The session cookie is first-party and same-origin
  // now; allowing credentials on a cross-origin response would require `SameSite=None`, which
  // re-opens both the CSRF surface and the third-party-cookie deprecation path.
  const webOrigin = process.env.WEB_ORIGIN;
  const allowedOrigins = webOrigin
    ? webOrigin
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'If-Match'],
    exposedHeaders: ['Retry-After', 'X-Request-Id'],
    maxAge: 600,
  });
  if (allowedOrigins.length === 0) {
    new Logger('main').warn(
      'WEB_ORIGIN is not set: cross-origin browser requests will be rejected. ' +
        'Same-origin requests through a console proxy are unaffected.',
    );
  }

  await app.listen(port);
  new Logger('main').log(`api listening on :${port}`);
}

bootstrap().catch((error: unknown) => {
  new Logger('main').error(error);
  process.exit(1);
});
