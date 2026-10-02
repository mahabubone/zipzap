/**
 * Entrypoint 1 of 3 — the HTTP API.
 *
 * Serves HTTP, validates, dispatches use cases. Scales with request rate.
 * See docs/architecture/overview.md#why-three-entrypoints.
 */

import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/exception.filter';
import { config } from './config';

async function bootstrap(): Promise<void> {
  const { port, isProduction } = config();
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

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
