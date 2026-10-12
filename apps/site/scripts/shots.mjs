/**
 * Captures the documentation site into shots/.
 *
 * The docs site is one of the five surfaces in the product, and for a reviewer it is the one that
 * explains all the others — the generated API reference is built from the same OpenAPI spec the
 * client is generated from, so a shot of it is a shot of the contract, not of a mockup.
 *
 * `sync:spec` must have run first: the API reference page reads `/openapi.json` out of `public/`,
 * and a page that 404s its own spec renders blank with no error. Turbo encodes that ordering
 * (see the `sync:spec` comment in turbo.json); running this against a dev server without it
 * produces an empty reference that looks like a styling bug.
 *
 * Run: pnpm --filter @zipzap/site dev, then
 *      node apps/site/scripts/shots.mjs
 */
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core').then(
  (m) => m.default ?? m,
);
import fs from 'node:fs';

const SITE = process.env.SITE_URL ?? 'http://localhost:4321';
const OUT = new URL('../../../shots/', import.meta.url).pathname;
const DATE = process.env.SHOT_DATE ?? new Date().toISOString().slice(0, 10);

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

async function shoot(path, name, fullPage = true) {
  await page.goto(`${SITE}${path}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  const file = `${OUT}${DATE}_site_${name}.png`;
  await page.screenshot({ path: file, fullPage });
  console.log(`shot  ${file}`);
}

await shoot('/', 'docs_index');
await shoot('/rider', 'docs_rider');
await shoot('/merchant-onboarding/getting-started', 'docs_getting_started');
// The API reference is the page worth the most in a screenshot: it is generated from the spec, so
// its presence is evidence the contract is real and current rather than a hand-written page that
// drifted from it months ago.
await shoot('/api-reference', 'api_reference');

await browser.close();
