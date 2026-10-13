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

/**
 * Capture the VIEWPORT, not the whole scrollable page.
 *
 * This defaulted to `fullPage: true` in every app, which produced a 6,145-pixel screenshot of the
 * API reference and a 1,582-pixel one of the landing page — images four times taller than the
 * screen they claim to depict. In a README they render as a sliver, and the argument they were
 * meant to make (this is what the product looks like) is lost to a scrollbar.
 *
 * A screenshot is a photograph of a screen. If a screen needs 6,000 pixels to be understood, the
 * problem is the screen, not the photograph — and the honest fix is to crop, not to ship the whole
 * page as an unreadable strip.
 *
 * `FULL_PAGE=1` still captures the scroll, for the rare case where the whole document IS the
 * point. Nothing in shots/ needs it.
 */

async function shoot(path, name, fullPage = process.env.FULL_PAGE === '1') {
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
