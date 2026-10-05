/**
 * Entrypoint 1 of 3 — the HTTP API.
 *
 * Serves HTTP, validates, dispatches use cases. Scales with request rate.
 * See docs/architecture/overview.md#why-three-entrypoints.
 */

import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/exception.filter';
import { config } from './config';

async function bootstrap(): Promise<void> {
  const { port, isProduction } = config();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  // Bulk CSV uploads ride inside JSON (the CSV text is what matters, not its
  // transport encoding). A 10,000-row file is ~850KB — the default 100KB JSON
  // limit would reject it before validation runs. 10MB covers the exit gate;
  // the DTO still caps `csv` at 10M chars.
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

  app.enableShutdownHooks();
  await app.listen(port);
  new Logger('main').log(`api listening on :${port}`);
}

bootstrap().catch((error: unknown) => {
  new Logger('main').error(error);
  process.exit(1);
});
