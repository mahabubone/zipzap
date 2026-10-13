/**
 * Exports the OpenAPI spec derived from controller decorators.
 *
 * Usage: pnpm --filter @zipzap/backend openapi:export
 * Writes: openapi.json and openapi.yaml (both committed — they are the contract diff surface).
 *
 * Mirrors main.ts but never listens: boots the app, derives the document, writes it, exits.
 * Run after `pnpm build`; import from dist like seed.mjs.
 *
 * Both formats come from the same `buildDocument`, so the JSON and the YAML cannot disagree —
 * they are two serialisations of one object, not two sources.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dump } from 'js-yaml';
import 'reflect-metadata';

const here = dirname(fileURLToPath(import.meta.url));
const outJson = join(here, '..', 'openapi.json');
const outYaml = join(here, '..', 'openapi.yaml');

const { NestFactory } = await import('@nestjs/core');
const { buildDocument } = await import('../dist/openapi.js');
const { AppModule } = await import('../dist/app.module.js');
const { DomainExceptionFilter } = await import('../dist/common/exception.filter.js');

const app = await NestFactory.create(AppModule, { logger: false });
app.useGlobalFilters(new DomainExceptionFilter());

const document = buildDocument(app);
const operations = Object.values(document.paths ?? {}).reduce(
  (total, item) =>
    total +
    Object.values(item ?? {}).filter((value) => typeof value === 'object' && value !== null).length,
  0,
);

await app.close();
writeFileSync(outJson, `${JSON.stringify(document, null, 2)}\n`);
writeFileSync(outYaml, dump(document, { lineWidth: 100 }));
console.log(`wrote ${outJson} and ${outYaml} (${operations} operations)`);
// BullMQ/Redis handles keep the loop alive past app.close(); this is a
// one-shot script, not a server — exiting is the correct shutdown.
process.exit(0);
