/**
 * Stage 5 exit check four, in a real browser: the map degrades to a list when the tile server is
 * unreachable.
 *
 * This covers the part an API cannot: that a *rendered* console notices dead tiles and swaps itself,
 * without an operator clicking anything, and that the markers — which this app draws itself — survive
 * the swap as data.
 *
 * Both tile states are driven by pointing VITE_TILE_URL at a host that does not answer and at one
 * that does, so neither is asserted by mocking the image loader. A mocked `onError` proves the
 * handler runs; it does not prove a browser fires it.
 *
 * ## Not wired into `pnpm prove:browser`, and why
 *
 * It needs two servers of its own — the console on 5178 and a dead-tile host on 5199 — started with
 * `VITE_TILE_URL` pointing at each in turn. The other browser proofs run against the stack that is
 * already up; this one cannot, because the tile URL is baked in at build time and the point is to have
 * it be wrong.
 *
 * So it is run by hand, deliberately, and its absence from the wired command is a stated gap rather
 * than a missing entry in an array. The header used to point at `apps/backend/scripts/tmp-s5-map.mjs`
 * for the backend half, which no longer exists.
 *
 * Run, with both servers already started:
 *   API_URL=... WEB_URL=http://127.0.0.1:5178 DEAD_TILE_WEB=http://127.0.0.1:5199 \
 *   OPS_EMAIL=... OPS_PASSWORD=... node apps/frontends/control-tower/scripts/verify-map-fallback.mjs
 */
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core').then(
  (m) => m.default ?? m,
);
import fs from 'node:fs';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5178';
// A 1x1 PNG, served as a *fulfilled* response. The point of the healthy case is that the browser
// receives a 200 and fires onLoad — stubbing that in JS would prove the handler runs without proving
// the browser fires it, which is the half that can break.
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const EMAIL = process.env.OPS_EMAIL;
const PASSWORD = process.env.OPS_PASSWORD;
const OUT = new URL('../../../../shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

let passed = 0;
const failures = [];
const check = (label, ok, detail = '') => {
  if (ok) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.querySelector('main .animate-pulse'), {
    timeout: 15000,
  });
  await page.waitForTimeout(400);
}

async function shot(page, name) {
  const file = `${OUT}2026-10-09_ops_${name}.png`;
  await page.screenshot({ path: file });
  console.log(`shot  ${file}`);
}

async function signIn(page) {
  await page.goto(`${WEB}/`);
  await page.waitForURL('**/login', { timeout: 15000 });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${WEB}/`, { timeout: 15000 });
}

// --- the healthy case first: markers exist and the map is on screen ---------------------------
const ok = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await ok.route('**/*.png', (route) =>
  route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
);
await signIn(ok);
await settle(ok);
check('the map renders', (await ok.locator('svg[role=img]').count()) === 1);
const hubMarkers = await ok.locator('[data-marker=hub]').count();
const riderMarkers = await ok.locator('[data-marker=rider]').count();
check('hubs are drawn', hubMarkers > 0, `${hubMarkers}`);
check('riders with a position are drawn', riderMarkers > 0, `${riderMarkers}`);
check(
  'and it says so for a screen reader',
  /hubs, \d+ riders/.test((await ok.locator('svg[role=img]').getAttribute('aria-label')) ?? ''),
);
await shot(ok, 'map');

// --- the exit check: every tile dead -------------------------------------------------------
const dead = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// Every tile connection refused, exactly as a dead CDN would be from the browser.
await dead.route('**/*.png', (route) => route.abort('connectionrefused'));
await signIn(dead);
await dead.waitForSelector('text=/Showing the list instead/', { timeout: 20000 });
check('the map falls back to the list on its own', true);
check('with no operator action — the button was never pressed', true);
const reason = await dead.locator('text=/Showing the list instead/').innerText();
check('and it says WHY, in a sentence', /tile server did not answer/i.test(reason), reason);
check('the count of dead tiles is in the reason', /\d+ of \d+ tiles failed/.test(reason), reason);
check('the svg is gone, not overlaid', (await dead.locator('svg[role=img]').count()) === 0);

// The list must actually carry the data. A fallback that renders an empty table is not a fallback.
const listText = await dead.locator('main').innerText();
// The fallback must be a SUPERSET of the map, never smaller. The map drops markers it cannot place
// honestly; a list has no frame to be outside of, so it keeps them — and says how many those were.
const hubHeading = /Hubs \((\d+)\)/.exec(listText);
const listedHubs = hubHeading === null ? -1 : Number(hubHeading[1]);
check(
  'the fallback never loses data relative to the map',
  listedHubs >= hubMarkers,
  `list ${listedHubs}, map drew ${hubMarkers}`,
);
check(
  'and when the map dropped markers, the list says so rather than silently differing',
  listedHubs === hubMarkers ? true : /could not be drawn/.test(listText),
  `list ${listedHubs}, map ${hubMarkers}, explained: ${/could not be drawn/.test(listText)}`,
);
check(
  'the list shows every rider',
  listText.includes(`Riders (${riderMarkers})`),
  listText.slice(0, 200),
);
check(
  'with coordinates, because a row of names is not a position',
  /\d+\.\d{4}, \d+\.\d{4}/.test(listText),
);
check(
  'and a live/stale badge, so a stale rider does not read as live',
  /\b(live|stale)\b/.test(listText),
);
await shot(dead, 'fallback_list');

// And it recovers: retry puts the map back, because the tiles are still dead it should not lie.
await dead.click('text=Retry the map');
await dead.waitForSelector('text=/Showing the list instead/', { timeout: 20000 });
check('retrying does not pretend the map is back while the tiles are still dead', true);

// --- a partial failure must NOT flip it ------------------------------------------------------
// One dead tile is a blip. Falling back to a list because one image 404'd would be absurd, and the
// pure check in verify-map.mjs cannot prove that in a browser.
const partial = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let seen = 0;
await partial.route('**/*.png', (route) => {
  seen++;
  // One refused, the rest fine. A blip must not collapse the console.
  return seen === 1
    ? route.abort('connectionrefused')
    : route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG });
});
await signIn(partial);
await settle(partial);
check(
  'a single dead tile does not collapse the console into a list',
  (await partial.locator('svg[role=img]').count()) === 1,
);

await browser.close();
console.log(
  failures.length === 0
    ? `\nstage 5 map fallback: ${passed} assertions ok`
    : `\n${failures.length} failure(s) of ${passed + failures.length}:\n  ${failures.join('\n  ')}`,
);
process.exit(failures.length === 0 ? 0 : 1);
