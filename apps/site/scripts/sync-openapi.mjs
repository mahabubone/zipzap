/**
 * Copies the backend's OpenAPI spec into the site's public directory.
 *
 * This is what makes "latest synced openapi-specs" true rather than aspirational: `pnpm api:sync`
 * regenerates `apps/backend/openapi.json` from the controller decorators, and this script carries
 * that file into `public/` where Stoplight Elements can fetch it. Nothing is hand-copied, and
 * nothing in this site is allowed to hand-write a schema.
 *
 * Run before `astro build` (turbo orders it) and before `astro dev`.
 *
 * Fails loudly if the source is missing, rather than copying whatever was there last. A docs site
 * serving a stale contract is worse than one that does not build, and the failure mode of a
 * silently-absent spec is a blank API reference that nobody notices until a user reports it.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

/** The contract artefact, regenerated from controller decorators by `api:sync`. */
const SOURCE = join(repoRoot, 'apps', 'backend', 'openapi.json');
/** Where the site serves it from. Served at the site root so the build never embeds a path. */
const TARGET_DIR = join(here, '..', 'public');
const TARGET = join(TARGET_DIR, 'openapi.json');

if (!existsSync(SOURCE)) {
  console.error(
    [
      `openapi.json not found at ${SOURCE}`,
      '',
      'Generate it first:',
      '  pnpm api:sync',
      '',
      'It is a build artefact, not a committed blob you can edit — it is derived from the',
      'controller decorators, and editing it here would make the docs and the server disagree.',
    ].join('\n'),
  );
  process.exit(1);
}

const stats = statSync(SOURCE);
if (stats.size < 500) {
  console.error(
    `openapi.json is suspiciously small (${stats.size} bytes) — a truncated spec would render a blank reference.`,
  );
  process.exit(1);
}

// A cheap structural sanity check before handing it to a renderer that will fail silently.
const spec = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(SOURCE, 'utf8')));
if (!spec.paths || typeof spec.paths !== 'object' || Object.keys(spec.paths).length === 0) {
  console.error('openapi.json has no `paths` — nothing would render.');
  process.exit(1);
}

mkdirSync(TARGET_DIR, { recursive: true });
copyFileSync(SOURCE, TARGET);

const operations = Object.values(spec.paths).reduce(
  (total, item) => total + Object.values(item ?? {}).length,
  0,
);
console.log(
  `synced openapi.json → apps/site/public/openapi.json (${Object.keys(spec.paths).length} paths, ` +
    `${operations} operations)`,
);
