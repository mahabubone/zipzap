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
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/**
 * The capture date, read once.
 *
 * It was a literal `2026-10-08` in this file until 2026-10-12, which meant every re-shoot silently
 * overwrote the original images under the same name and the directory's date prefix stopped
 * meaning anything — the one thing the prefix is for. A shot from last week and a shot from today
 * looked identical in a filename. Overridable with SHOT_DATE for a deliberate backfill.
 */
const DATE = process.env.SHOT_DATE ?? new Date().toISOString().slice(0, 10);

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
  const file = `${OUT}${DATE}_web_${name}.png`;
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

/**
 * The console's own routes, in the order a merchant would meet them.
 *
 * This list was one entry long for the first two months of screenshots, so shots/ showed a
 * shipments table and nothing else about a console with ten screens. A reviewer scrolling that
 * directory would reasonably conclude the product was a list and a detail page.
 *
 * Order is the merchant's day: create, watch, collect, settle. Money before webhooks because COD
 * and settlement are what this vertical is actually for — Bangladesh is cash-on-delivery, and a
 * logistics OS that treats the cash as an afterthought is not the product being described.
 */
const ROUTES = [
  ['app_overview', '/app'],
  ['app_shipments', '/app/shipments'],
  ['app_shipment_new', '/app/shipments/new'],
  ['app_cod', '/app/cod'],
  ['app_settlements', '/app/settlements'],
  ['app_money', '/app/money'],
  ['app_analytics', '/app/analytics'],
  ['app_pricing', '/app/pricing'],
  ['app_webhooks', '/app/webhooks'],
];

for (const [name, path] of ROUTES) {
  await page.goto(`${CONSOLE}${path}`);
  await settle(page);
  const body = await page.locator('body').innerText();
  if (body.includes('Something went wrong')) {
    throw new Error(`${path} rendered an error box — refusing to photograph it`);
  }
  await shoot(page, name);
}

/**
 * Bulk import, photographed as a PREVIEW rather than as an empty file picker.
 *
 * The screen's whole claim is "nothing is created until you accept", and a screenshot of an empty
 * file input is a screenshot of nothing: it looks identical whether the preview works, refuses a bad
 * file, or never existed. So this uploads a real CSV — the app's own template columns, with one row
 * that will import and one that will not, because the interesting part of a preview is where the rows
 * disagree — and shoots the table the server sends back.
 *
 * The file goes to the OS temp directory because `setInputFiles` takes a path, and it is removed in a
 * `finally` so a run that fails halfway does not leave a stray CSV lying about.
 *
 * If the upload produces no preview, the run says so and shoots the screen as it is. A line in the
 * log is honest; a file named `app_bulk` showing an error box is not.
 */
await page.goto(`${CONSOLE}/app/shipments/bulk`);
await settle(page);
/**
 * The file is named the way a merchant would name it.
 *
 * The preview header prints the uploaded file's own name, so a `zipzap-shots-bulk-<epoch>.csv` lands
 * in the middle of the screenshot and the shot stops looking like a person doing their job. The name
 * is still unique enough to be written into a temp directory without colliding with a real one.
 */
const csvPath = join(tmpdir(), `orders-week-42-${process.pid}.csv`);
writeFileSync(
  csvPath,
  [
    'invoice,recipient_name,recipient_phone,recipient_address,cod_amount,parcel_weight,item_description',
    'INV-9001,Shahana Akter,+8801810000901,"Agrabad C/A, Chattogram",125050,1200,Two shirts',
    'INV-9002,Nasim Uddin,+8801810000902,"Zindabazar, Sylhet",98000,800,Running shoes',
    // A row the backend will refuse — no recipient phone. It belongs in the shot: a preview that has
    // only ever shown green is a preview nobody has learned to read.
    'INV-9003,Mahbub Alam,,"Bogura bazar",54000,600,Gift box',
    '',
  ].join('\n'),
);
try {
  await page.setInputFiles('input[type="file"]', csvPath);
  // The job goes to PREVIEW and the accept button only appears once the rows are known, so waiting
  // for the button is waiting for the answer rather than for a number of milliseconds.
  await page.waitForSelector('button:has-text("Import")', { timeout: 30000 }).catch(() => {});
  await settle(page);
  const previewed = (await page.locator('body').innerText()).includes('Will import');
  console.log(
    previewed ? '      bulk preview rendered' : '      no preview — shooting the screen as it is',
  );
} finally {
  rmSync(csvPath, { force: true });
}
await shoot(page, 'app_bulk');

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

/**
 * Put the three switches back to all-on before toggling.
 *
 * The script used to assume a fresh database and click the second switch expecting it to go off.
 * The second run of the day then found it already off, clicked it back on, and failed its own
 * assertion with `switch 1 never became false (still true)` — which reads like the optimistic
 * update regressed, when in fact the script had simply been run twice against the same fixture.
 *
 * A screenshot script that only works once is a screenshot script you cannot use to check a change,
 * which is the only reason to have one. So: restore the known state first, then assert.
 */
for (const [index, target] of [
  [0, 'true'],
  [1, 'true'],
  [2, 'true'],
]) {
  if ((await switches.nth(index).getAttribute('aria-checked')) !== target) {
    await switches.nth(index).click();
    await waitForChecked(index, target);
  }
}

await switches.nth(1).click();
await waitForChecked(1, 'false');
// The other two must be untouched. Before the optimistic update was scoped to the tapped row, one
// click moved all three and this is what would have failed.
await waitForChecked(0, 'true');
await waitForChecked(2, 'true');
await shoot(page, 'app_notifications_muted');

// The shipment list, then the detail routes.
//
// Both detail shots are taken from THIS page load, before navigating anywhere else. An earlier
// version clicked the first row, shot it, and only afterwards went looking for a delivered parcel
// — by which point it was no longer on the list, so the lookup silently matched nothing and the
// delivered shot was skipped with a message that read like missing data rather than a script bug.
await page.goto(`${CONSOLE}/app/shipments`);
await settle(page);

// A DELIVERED parcel specifically, which is the screen worth having in a portfolio.
//
// Clicking the first row photographs whatever the newest shipment happens to be, and after
// `seed:shots` that is a LOST parcel — correct, and a poor advertisement. A delivered parcel's
// timeline is the whole argument: pickup, two hubs, a dispatch, a proof of delivery and a COD
// collection, in order, attributed to whoever did each thing.
// `hasText` with an anchored regex fails here: the status cell is its own element, so the row's
// text is "ZP-…DeliveredDhaka metro…" on one line and `^Delivered$` can never match it. A plain
// substring is what actually identifies the row, and it is scoped to the tracking column so a
// recipient address containing the word could never be mistaken for a status.
const deliveredRow = page
  .locator('tbody tr')
  .filter({ has: page.getByText('Delivered', { exact: true }) })
  .first();
if ((await deliveredRow.count()) > 0) {
  await deliveredRow.click();
  await page.waitForURL('**/app/shipments/**', { timeout: 15000 });
  await page.waitForTimeout(600);
  await shoot(page, 'app_shipment_delivered');
  await page.goBack();
  await settle(page);
} else {
  console.log('skip  app_shipment_delivered (no delivered parcel in the fixture set)');
}

// One row click proves the table navigates to the detail route.
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
