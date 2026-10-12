/**
 * Captures the hub console into shots/.
 *
 * This app had screenshots in shots/ from a previous session with no script to regenerate them,
 * which is the state AGENTS.md calls out: after any visible change, capture fresh ones. A shot you
 * cannot re-take is a shot that quietly stops being true.
 *
 * Signed in as the HUB_OPERATOR the seed mints — a role whose only write scope is `hub:scan`, so
 * it can move parcels between hubs and cannot create, cancel or settle anything. Photographing it
 * with the merchant owner instead would show a screen full of permissions the hub does not have.
 *
 * Run: node apps/frontends/hub-console/scripts/shots.mjs
 * Needs: SEED_HUB_EMAIL / SEED_HUB_PASSWORD (from `pnpm db:seed`), and this app's dev server.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core').then(
  (m) => m.default ?? m,
);
import fs from 'node:fs';

const APP = process.env.APP_URL ?? 'http://localhost:5174';
const EMAIL = process.env.SEED_HUB_EMAIL;
const PASSWORD = process.env.SEED_HUB_PASSWORD;
const HUB_CODE = process.env.SEED_HUB_CODE ?? 'DAC-D';
const OUT = new URL('../../../../shots/', import.meta.url).pathname;
const DATE = process.env.SHOT_DATE ?? new Date().toISOString().slice(0, 10);

fs.mkdirSync(OUT, { recursive: true });

if (!EMAIL || !PASSWORD) {
  console.error('Set SEED_HUB_EMAIL and SEED_HUB_PASSWORD (see `pnpm db:seed` output).');
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

async function shoot(page, name, fullPage = process.env.FULL_PAGE === '1') {
  const file = `${OUT}${DATE}_hub_${name}.png`;
  await page.screenshot({ path: file, fullPage });
  console.log(`shot  ${file}`);
}

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`${APP}/login`);
await settle(page);
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type="submit"]');
await page
  .waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 })
  .catch(() => {});
await settle(page);

await shoot(page, 'worklist');

// The hub itself, reached by code. Exists as a route so an operator can deep-link to their own
// site without picking from a list first.
await page.goto(`${APP}/hubs/${HUB_CODE}`);
await settle(page);
await shoot(page, 'hub_detail');

await page.goto(`${APP}/manifests`);
await settle(page);
await shoot(page, 'manifests');

await browser.close();
