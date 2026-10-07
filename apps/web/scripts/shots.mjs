/**
 * Captures the console screens into shots/ per the repo's visual-memory rule.
 * Logs in through the real form, then visits each route — so a shot that looks
 * right means the route, the auth guard and the API all worked.
 *
 * Run: SEED_CONSOLE_EMAIL=... SEED_CONSOLE_PASSWORD=... node apps/web/scripts/shots.mjs
 */
// playwright-core from a global install, not a project dependency — a shot
// script must not add a runtime dep to the web app.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core').then(
  (m) => m.default ?? m,
);
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

async function settle(page) {
  await page.waitForLoadState('networkidle');
  // A click before React hydrates falls through to a native form submit.
  await page.waitForFunction(() => !document.querySelector('main .animate-pulse'), {
    timeout: 15000,
  });
  await page.waitForTimeout(400);
}

async function shoot(page, name, fullPage = true) {
  const file = `${OUT}2026-10-07_web_${name}.png`;
  await page.screenshot({ path: file, fullPage });
  console.log(`shot  ${file}`);
}

// --- public: home and login, before any session exists -----------------------
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
await anon.close();

// --- console, behind the guard ------------------------------------------------
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`${WEB}/login`);
await settle(page);
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL('**/app', { timeout: 15000 });

for (const [name, path] of [
  ['app_control_tower', '/app'],
  ['app_shipments', '/app/shipments'],
  ['app_track', '/app/track'],
]) {
  await page.goto(`${WEB}${path}`);
  await settle(page);
  await shoot(page, name);
}

// One row click proves the table navigates to the detail route.
await page.goto(`${WEB}/app/shipments`);
await settle(page);
await page.click('tbody tr');
await page.waitForURL('**/app/shipments/**', { timeout: 15000 });
await page.waitForTimeout(600);
await shoot(page, 'app_shipment_detail');

// Mobile: the drawer is the one responsive path the shell has.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${WEB}/app`);
await page.waitForLoadState('networkidle');
await page.waitForSelector('button[aria-label="Open navigation"]', { state: 'visible' });
await page.click('button[aria-label="Open navigation"]');
await page.waitForTimeout(400);
await shoot(page, 'app_mobile_drawer', false);

await browser.close();
