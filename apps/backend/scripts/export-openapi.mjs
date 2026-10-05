/**
 * Exports the OpenAPI spec derived from controller decorators.
 *
 * Usage: node --env-file=../../.env scripts/export-openapi.mjs
 * Writes: ../openapi.json (committed — it is the contract diff surface).
 *
 * Mirrors main.ts but never listens: boots the app, derives the document,
 * writes it, exits. Run after `pnpm build`; import from dist like seed.mjs.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'reflect-metadata';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'openapi.json');

const { NestFactory } = await import('@nestjs/core');
const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
const { AppModule } = await import('../dist/app.module.js');

const app = await NestFactory.create(AppModule, { logger: false });
app.useGlobalFilters(new (await import('../dist/common/exception.filter.js')).DomainExceptionFilter());

const document = SwaggerModule.createDocument(
  app,
  new DocumentBuilder()
    .setTitle('ZipZap API')
    .setDescription('Logistics operating system for e-commerce fulfillment and last-mile delivery.')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'Authorization', in: 'header' }, 'ApiKey')
    .build(),
);

await app.close();
writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(`wrote ${outPath} (${Object.keys(document.paths).length} paths)`);
// BullMQ/Redis handles keep the loop alive past app.close(); this is a
// one-shot script, not a server — exiting is the correct shutdown.
process.exit(0);
