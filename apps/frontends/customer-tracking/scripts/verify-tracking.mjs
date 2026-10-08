/**
 * Asserts the public tracking surface renders for a recipient who has a code and
 * no account — the fifth projection of the same events.
 *
 * Run: TRACKING_CODE=ZP-... PLAYWRIGHT_CORE=<path>/playwright-core/index.js \
 *      node apps/frontends/customer-tracking/scripts/verify-tracking.mjs
 */
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core').then(
  (m) => m.default ?? m,
);

// This app's own dev server. The merchant console is a different origin entirely.
const WEB = process.env.WEB_URL ?? 'http://localhost:5174';
const MERCHANT_WEB = process.env.MERCHANT_WEB_URL ?? 'http://localhost:5173';
const CODE = process.env.TRACKING_CODE;
if (!CODE) {
  console.error('set TRACKING_CODE');
  process.exit(2);
}

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`,
  );
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

// --- the lookup page ---------------------------------------------------------
await page.goto(`${WEB}/track`);
await page.waitForLoadState('networkidle');
check('no client errors on /track', pageErrors, []);
check('lookup has a heading', await page.locator('h1').innerText(), 'Track your parcel');
check('lookup has no console nav', await page.locator('nav[aria-label="Main"]').count(), 0);

// --- typing a code navigates, without a session -----------------------------
await page.fill('input[name="trackingCode"]', '  ' + CODE.toLowerCase() + '  ');
await page.click('button[type="submit"]');
await page.waitForURL(`**/track/${CODE}`, { timeout: 15000 });
check('uppercases and trims the code', page.url().endsWith(CODE), true);

// --- the result --------------------------------------------------------------
await page.waitForSelector('ol li', { timeout: 15000 });
const parcel = await page.evaluate(() => ({
  code: document.querySelector('h1')?.textContent,
  events: document.querySelectorAll('ol li').length,
  hasSkeleton: !!document.querySelector('main .animate-pulse'),
  // The public projection must not leak merchant money.
  bodyMentionsAmount: /৳|amount|cod/i.test(document.body.innerText),
  navCount: document.querySelectorAll('nav[aria-label="Main"]').length,
}));
check('the code is on the page', parcel.code, CODE);
check('timeline rendered an event', parcel.events > 0, true);
check('skeleton is gone', parcel.hasSkeleton, false);
check('no money leaked into the public page', parcel.bodyMentionsAmount, false);
check('no merchant console nav', parcel.navCount, 0);
check('no client errors after load', pageErrors, []);

// --- an unknown code fails visibly, not blank -------------------------------
await page.goto(`${WEB}/track/ZP-DOESNOTEXIST`);
await page.waitForTimeout(1500);
const missing = await page.evaluate(() => ({
  allText: [...document.querySelectorAll('h1, h2, p, [role="alert"]')]
    .map((e) => e.textContent)
    .filter(Boolean)
    .slice(0, 8),
}));
check(
  'unknown code shows an error state',
  missing.allText.some((t) => t.includes('Parcel not found')),
  true,
);

// --- the merchant landing page links out to this app -------------------------
await page.goto(`${MERCHANT_WEB}/`);
await page.waitForLoadState('networkidle');
check(
  'landing links out to this app',
  await page.locator(`a[href="${WEB}/track"]`).count() >= 1,
  true,
);

await browser.close();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
