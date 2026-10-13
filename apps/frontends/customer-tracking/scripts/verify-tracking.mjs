/**
 * Asserts the public tracking surface renders for a recipient who has a code and
 * no account — the fifth projection of the same events.
 *
 * `TRACKING_WEB_URL` rather than `WEB_URL`, so two proofs in one command can each name the app they
 * are about — see the note at the top of `merchant-web/scripts/verify-marketing.mjs`.
 *
 * Run: TRACKING_CODE=ZP-... TRACKING_WEB_URL=http://localhost:5174 \
 *      MERCHANT_WEB_URL=http://localhost:5173 PLAYWRIGHT_CORE=<path>/playwright-core/index.js \
 *      node apps/frontends/customer-tracking/scripts/verify-tracking.mjs
 */
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core').then(
  (m) => m.default ?? m,
);

// This app's own dev server. The merchant console is a different origin entirely.
const WEB = process.env.TRACKING_WEB_URL ?? process.env.WEB_URL ?? 'http://localhost:5174';
const MERCHANT_WEB = process.env.MERCHANT_WEB_URL ?? 'http://localhost:5173';
/**
 * The parcel this proof photographs.
 *
 * It used to be `TRACKING_CODE`, and it had to be: the script had no way to reach the database, so the
 * operator had to query one out and paste it in. `pnpm prove:browser` runs four proofs and three of
 * them need nothing, so this one silently aborted the whole command with two words — `set
 * TRACKING_CODE` — which is the least useful message a command can end on.
 *
 * So it finds a subject itself, the way the other proofs find their own. `TRACKING_CODE` still wins, for
 * someone who wants to photograph one particular journey.
 *
 * **Delivered, most recent first, and why those two words.** A public tracking page is at its most
 * informative at the end of a journey: every scan, the COD collection and the proof-of-delivery are all
 * on it. A parcel in transit shows four rows and a timeline that lies by omission. And "most recent"
 * rather than "any", because the assertion that the final state reads *Delivered* is only meaningful on
 * a parcel that has one.
 */
async function resolveCode() {
  if (process.env.TRACKING_CODE) return { code: process.env.TRACKING_CODE, from: 'TRACKING_CODE' };

  const url = process.env.DATABASE_URL;
  if (!url) {
    return {
      error: [
        'No parcel to photograph: neither TRACKING_CODE nor DATABASE_URL is set.',
        '',
        '  Either give a code —',
        '',
        '    TRACKING_CODE=ZP-XXXX pnpm prove:browser',
        '',
        '  or point at a database that has one, which is what DATABASE_URL is for and what',
        '  `pnpm prove:browser` already needs for the hub console proof.',
      ].join('\n'),
    };
  }

  // The same `pg` the hub console proof uses: a root-level script cannot import it by name, because the
  // root package deliberately has no dependencies.
  const pg = (await import(process.env.PG ?? '../../../backend/node_modules/pg/esm/index.mjs'))
    .default;
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const result = await client.query(
      `SELECT tracking_code FROM shipment.shipments
        WHERE status = 'DELIVERED' ORDER BY created_at DESC LIMIT 1`,
    );
    if (result.rows.length === 0) {
      return {
        error: [
          'No delivered parcel to photograph.',
          '',
          '  This proof follows a journey to its end, and the database holds none — so there is nothing',
          '  for it to check. `pnpm seed:shots` writes a full set; without it this is not a failure of',
          '  the public page, it is an empty subject.',
        ].join('\n'),
      };
    }
    return { code: result.rows[0].tracking_code, from: 'the most recent delivered shipment' };
  } catch (error) {
    return {
      error: [
        'Could not read the database to find a parcel to photograph.',
        '',
        `  ${error.message}`,
        '',
        '  Set TRACKING_CODE to photograph a parcel without the database.',
      ].join('\n'),
    };
  } finally {
    await client.end().catch(() => {});
  }
}

const subject = await resolveCode();
if (subject.error) {
  console.error(subject.error);
  process.exit(2);
}
const CODE = subject.code;
console.log(`photographing ${CODE} — ${subject.from}`);

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
const parcel = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    code: document.querySelector('h1')?.textContent,
    events: document.querySelectorAll('ol li').length,
    hasSkeleton: !!document.querySelector('main .animate-pulse'),
    // A figure, not the word. The check used to be `/৳|amount|cod/i`, which flags the timeline event
    // `COD_COLLECTED` — an event name, not a sum. That is a false positive on the one piece of the
    // journey a recipient most wants to see: the courier has the money.
    //
    // So it asserts what it means: no currency symbol, and no grouped figure of the shape a taka
    // amount would take. The event itself is asserted present, two checks below.
    hasCurrencySymbol: text.includes('৳'),
    hasGroupedAmount: /\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b/.test(text),
    mentionsCashEvent: /cash collected|cod collected/i.test(text),
    navCount: document.querySelectorAll('nav[aria-label="Main"]').length,
  };
});
check('the code is on the page', parcel.code, CODE);
check('timeline rendered an event', parcel.events > 0, true);
check('skeleton is gone', parcel.hasSkeleton, false);
check('no money leaked into the public page', parcel.hasCurrencySymbol, false);
check('no amount rendered on the public page', parcel.hasGroupedAmount, false);
check('the cash event IS shown, by name', parcel.mentionsCashEvent, true);
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
  (await page.locator(`a[href="${WEB}/track"]`).count()) >= 1,
  true,
);

await browser.close();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
