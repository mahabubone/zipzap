/**
 * Captures the screens into shots/ per the repo's visual-memory rule. Logs in
 * through the real form, then visits each route — so a shot that looks right
 * means the route, the auth guard and the API all worked.
 *
 * Public tracking is a separate app on a separate origin, so this script shoots
 * both. Run each app's dev server first, or set CONSOLE_ONLY=1 to shoot the console alone.
 *
 * Run: SEED_CONSOLE_EMAIL=... SEED_CONSOLE_PASSWORD=... TRACKING_CODE=ZP-... \
 *      node apps/frontends/merchant-web/scripts/shots.mjs
 */
// playwright-core from a global install, not a project dependency — a shot
// script must not add a runtime dep to the web app.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core').then(
  (m) => m.default ?? m,
);
import fs from 'node:fs';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const TRACKING = process.env.TRACKING_URL ?? 'http://localhost:5174';
// WEB and CONSOLE are both merchant-web — the public home and the authenticated app are the same
// app on the same port. They are separate variables so CONSOLE_URL can point at a dev server on a
// non-default port without also repointing the pre-login shots.
const CONSOLE = process.env.CONSOLE_URL ?? WEB;
// CONSOLE_ONLY=1 skips the pre-login and tracking shots. Without it the script dies partway if the
// tracking app is not running, and it dies *after* writing some files — so a partial run is
// indistinguishable from a complete one in shots/.
const CONSOLE_ONLY = process.env.CONSOLE_ONLY === '1';
const EMAIL = process.env.SEED_CONSOLE_EMAIL;
const PASSWORD = process.env.SEED_CONSOLE_PASSWORD;
const OUT = new URL('../../../../shots/', import.meta.url).pathname;
const CODE = process.env.TRACKING_CODE;

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});

async function settle(page) {
  await page.waitForLoadState('networkidle');
  // A click before React hydrates falls through to a native form submit.
  await page.waitForFunction(() => !document.querySelector('main .animate-pulse'), {
    timeout: 15000,
  });
  await page.waitForTimeout(400);
}

async function shoot(page, name, fullPage = true) {
  const file = `${OUT}2026-10-08_web_${name}.png`;
  await page.screenshot({ path: file, fullPage });
  console.log(`shot  ${file}`);
}

// --- public: home and login, before any session exists -----------------------
if (CONSOLE_ONLY) {
  console.log('skip  site + tracking shots (CONSOLE_ONLY=1)');
} else {
  const anon = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await anon.goto(`${WEB}/`);
  await settle(anon);
  await shoot(anon, 'home');

  await anon.goto(`${WEB}/login`);
  await settle(anon);
  await shoot(anon, 'login');

  // The brand panel is lg-only, so the split only proves itself at desktop width.
  await anon.setViewportSize({ width: 900, height: 1000 });
  await anon.goto(`${WEB}/login`);
  await settle(anon);
  await shoot(anon, 'login_brand_hidden', false);

  // Tracking is public and lives in its own app: a recipient has a code, no account.
  await anon.setViewportSize({ width: 1440, height: 1000 });
  await anon.goto(`${TRACKING}/track`);
  await settle(anon);
  await shoot(anon, 'track_lookup', false);

  if (CODE) {
    await anon.goto(`${TRACKING}/track/${CODE}`);
    await settle(anon);
    await shoot(anon, 'track_parcel');

    await anon.goto(`${TRACKING}/track/ZP-NOSUCHCODE`);
    await anon.waitForTimeout(1200);
    await shoot(anon, 'track_not_found', false);
  }
  await anon.close();
}

// --- console, behind the guard ------------------------------------------------
// Skipped without credentials. A bare `seed` mints an empty merchant, and shots of
// empty tables are worse than the ones already in shots/ — so the fixture merchant
// is the one to shoot with.
if (!EMAIL || !PASSWORD) {
  console.log('skip  console shots (no SEED_CONSOLE_EMAIL / SEED_CONSOLE_PASSWORD)');
  await browser.close();
  process.exit(0);
}

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`${CONSOLE}/login`);
await settle(page);
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL('**/app', { timeout: 15000 });

for (const [name, path] of [['app_shipments', '/app/shipments']]) {
  await page.goto(`${CONSOLE}${path}`);
  await settle(page);
  await shoot(page, name);
}

/**
 * The control tower is shot as an operations manager, not as the merchant.
 *
 * `network:read` is an OPERATIONS_MANAGER scope and deliberately withheld from every merchant
 * role, and `notifications:manage` is the other way round. One principal cannot shoot both
 * screens — a run using the merchant for everything produced a control-tower shot of a
 * PERMISSION_DENIED error box, which is a fresh file showing a broken screen. A 403 in a shot is
 * worse than a stale shot, because it looks intentional.
 *
 * When SEED_OPS_EMAIL is absent the control tower is skipped rather than captured wrong.
 */
const opsPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
if (process.env.SEED_OPS_EMAIL) {
  await opsPage.goto(`${CONSOLE}/login`);
  await settle(opsPage);
  await opsPage.fill('#email', process.env.SEED_OPS_EMAIL);
  await opsPage.fill('#password', process.env.SEED_OPS_PASSWORD ?? '');
  await opsPage.click('button[type="submit"]');
  await opsPage.waitForURL('**/app', { timeout: 15000 });
  await opsPage.goto(`${CONSOLE}/app`);
  await settle(opsPage);
  // Fail loudly rather than capture the error box: a shot that says PERMISSION_DENIED is a false
  // record of what the product looks like.
  const body = await opsPage.locator('body').innerText();
  if (body.includes('Something went wrong') || body.includes('PERMISSION_DENIED')) {
    throw new Error('control tower rendered an error — check the ops account has network:read');
  }
  await shoot(opsPage, 'app_control_tower');
} else {
  console.log('skip  app_control_tower (no SEED_OPS_EMAIL)');
}
await opsPage.close();

// Notification preferences: the three-togge screen that all three competitors ship, and
// the one row where an unsent SMS is a bill and a complaint rather than a missing feature.
await page.goto(`${CONSOLE}/app/notifications`);
await settle(page);
await shoot(page, 'app_notifications');

// Toggle one off, so the shot holds the state a merchant actually produces: two on, one off.
const switches = page.locator('[role="switch"]');
// Click, then wait for the STATE rather than the clock. A fixed 600ms shot a page still showing the
// old value: the toggle is optimistic, React re-renders on the next tick, and the screenshot landed
// in between. Polling the aria-checked attribute is what makes this shot deterministic.
//
// `playwright-core` is the library, not the runner, so it ships locators and no `expect`. The
// polling is written out — and it doubles as the assertion that would have caught the optimistic
// update writing every row.
async function waitForChecked(index, expected) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const value = await switches.nth(index).getAttribute('aria-checked');
    if (value === expected) return;
    if (Date.now() > deadline) {
      throw new Error(`switch ${index} never became ${expected} (still ${value})`);
    }
    await page.waitForTimeout(100);
  }
}

await switches.nth(1).click();
await waitForChecked(1, 'false');
// The other two must be untouched. Before the optimistic update was scoped to the tapped row, one
// click moved all three and this is what would have failed.
await waitForChecked(0, 'true');
await waitForChecked(2, 'true');
await shoot(page, 'app_notifications_muted');

// One row click proves the table navigates to the detail route.
await page.goto(`${CONSOLE}/app/shipments`);
await settle(page);
await page.click('tbody tr');
await page.waitForURL('**/app/shipments/**', { timeout: 15000 });
await page.waitForTimeout(600);
await shoot(page, 'app_shipment_detail');

// Mobile: the drawer is the one responsive path the shell has.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${CONSOLE}/app`);
await page.waitForLoadState('networkidle');
await page.waitForSelector('button[aria-label="Open navigation"]', { state: 'visible' });
await page.click('button[aria-label="Open navigation"]');
await page.waitForTimeout(400);
await shoot(page, 'app_mobile_drawer', false);

await browser.close();
