/**
 * Captures the control tower — the network map — into shots/.
 *
 * The map is the single most-reproduced screen in the product and it is an SVG this app draws
 * itself from coordinates the API returned, so a shot is the only way to see what it actually
 * looks like. The label-collision bug that shipped in the first version (four hub codes printed
 * through each other in Dhaka) was invisible to `tsc`, invisible to the unit tests, and obvious
 * the moment anyone looked at the image.
 *
 * Signed in as an operations manager, because `network:read` is an OPERATIONS_MANAGER scope and
 * MERCHANT_OWNER deliberately does not hold it. Logging in as the merchant and screenshotting this
 * produces a PERMISSION_DENIED box — a file that looks like a broken product.
 *
 * Run: node apps/frontends/control-tower/scripts/shots.mjs
 * Needs: SEED_OPS_EMAIL / SEED_OPS_PASSWORD (from `pnpm db:seed`), and the app's dev server.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core').then(
  (m) => m.default ?? m,
);
import fs from 'node:fs';

const APP = process.env.APP_URL ?? 'http://localhost:5173';
const EMAIL = process.env.SEED_OPS_EMAIL;
const PASSWORD = process.env.SEED_OPS_PASSWORD;
const OUT = new URL('../../../../shots/', import.meta.url).pathname;
const DATE = process.env.SHOT_DATE ?? new Date().toISOString().slice(0, 10);

fs.mkdirSync(OUT, { recursive: true });

if (!EMAIL || !PASSWORD) {
  console.error('Set SEED_OPS_EMAIL and SEED_OPS_PASSWORD (see `pnpm db:seed` output).');
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}

async function shoot(page, name, fullPage = true) {
  const file = `${OUT}${DATE}_ops_${name}.png`;
  await page.screenshot({ path: file, fullPage });
  console.log(`shot  ${file}`);
}

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`${APP}/login`);
await settle(page);
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL('**/', { timeout: 15000 }).catch(() => {});
await settle(page);

// Fail loudly rather than photograph the error box. A shot that says PERMISSION_DENIED is a false
// record of what the product looks like, and worse than no shot at all.
const body = await page.locator('body').innerText();
if (body.includes('Something went wrong') || body.includes('PERMISSION_DENIED')) {
  throw new Error('control tower rendered an error — check the ops account has network:read');
}

await shoot(page, 'network_map');

// The list the map falls back to. Worth its own shot: the fallback is a decision (see
// docs/ADR/0011-postgis.md and the map's own header), and a decision nobody can see is a decision
// nobody will believe was made.
const markers = await page.locator('[data-marker="hub"]').count();
console.log(`      ${markers} hubs drawn`);
const suppressed = await page.locator('text=/too close to label/').count();
if (suppressed > 0) {
  // Not a failure — an honest report. The footer counts what it could not label rather than
  // silently dropping them, and that behaviour is worth stating out loud in the run log.
  console.log('      note: some hub labels were suppressed for lack of room');
}

await browser.close();
