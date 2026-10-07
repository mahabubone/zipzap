/**
 * Captures the console screens into shots/ per the repo's visual-memory rule.
 * Logs in through the real form, then visits each route — so a shot that looks
 * right means the route, the auth guard and the API all worked.
 *
 * Run: SEED_CONSOLE_EMAIL=... SEED_CONSOLE_PASSWORD=... node apps/web/scripts/shots.mjs
 */
// playwright-core from a global install, not a project dependency — a shot
// script must not add a runtime dep to the web app.
const { chromium } = await import(
  process.env.PLAYWRIGHT_CORE ?? 'playwright-core'
).then((m) => m.default ?? m);
import fs from 'node:fs';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const EMAIL = process.env.SEED_CONSOLE_EMAIL;
const PASSWORD = process.env.SEED_CONSOLE_PASSWORD;
const OUT = new URL('../../../shots/', import.meta.url).pathname;

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

// Sign in through the form rather than injecting a token — the shot should
// prove the login screen works too.
await page.goto(`${WEB}/login`);
// Wait for hydration: a click before React attaches onSubmit falls through to
// a native GET submit and silently navigates to /login?.
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type="submit"]');
try {
  await page.waitForURL('**/app', { timeout: 15000 });
} catch (e) {
  console.log('still on', page.url());
  console.log('body:', (await page.locator('body').innerText()).slice(0, 400));
  throw e;
}

const shots = [
  ['app_control_tower', '/app'],
  ['app_shipments', '/app/shipments'],
  ['app_track', '/app/track'],
];

for (const [name, path] of shots) {
  await page.goto(`${WEB}${path}`);
  // Wait for real data, not the skeleton — a skeleton shot is worthless.
  await page.waitForFunction(() => !document.querySelector('main .animate-pulse'), {
    timeout: 15000,
  });
  await page.waitForTimeout(400);
  const file = `${OUT}2026-10-07_web_${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`shot  ${file}`);
}

// One row click proves the table navigates to the detail route.
await page.goto(`${WEB}/app/shipments`);
// Wait out the skeleton — its rows are <tr> too, and they have no click handler.
await page.waitForFunction(() => !document.querySelector('main .animate-pulse'), {
  timeout: 15000,
});
await page.waitForSelector('tbody tr', { timeout: 15000 });
await page.click('tbody tr');
await page.waitForURL('**/app/shipments/**', { timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({
  path: `${OUT}2026-10-07_web_app_shipment_detail.png`,
  fullPage: true,
});
console.log(`shot  ${OUT}2026-10-07_web_app_shipment_detail.png`);

// Mobile: the drawer is the one responsive path the shell has.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${WEB}/app`);
// Reload after resizing: the lg: breakpoint hides the drawer button, and the
// class only re-evaluates on a fresh layout.
await page.waitForLoadState('networkidle');
await page.waitForSelector('button[aria-label="Open navigation"]', { state: 'visible' });
await page.click('button[aria-label="Open navigation"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}2026-10-07_web_app_mobile_drawer.png` });
console.log(`shot  ${OUT}2026-10-07_web_app_mobile_drawer.png`);

await browser.close();
