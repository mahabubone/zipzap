/**
 * Stage 5 exit check four, in a real browser: the map degrades to a list when the tile server is
 * unreachable.
 *
 * This covers the part an API cannot: that a *rendered* console notices dead tiles and swaps itself,
 * without an operator clicking anything, and that the markers — which this app draws itself — survive
 * the swap as data.
 *
 * ## How both tile states are driven
 *
 * At the network layer, inside the browser, with `page.route()`: every tile request refused for the
 * dead case, every tile answered with a real 1×1 PNG for the healthy one, and exactly one refused for
 * the partial case.
 *
 * That is deliberately below the application and above the mock. A mocked `onError` proves the handler
 * runs, which is not the thing that can break — what can break is the browser refusing to fire it, the
 * threshold being off by one, the SVG staying mounted behind the list, or a single 404 collapsing a
 * working console. Only a real load with real image failures exercises those.
 *
 * ## What this header used to claim, and why it was wrong
 *
 * It said the proof needed two dev servers of its own — this console on 5178 and a dead-tile host on
 * 5199 — because "the tile URL is baked in at build time and the point is to have it be wrong". That
 * was true when it was written and stopped being true when the two tile states moved to request
 * interception, which is also a better test: a refused request inside the browser is what a dead CDN
 * actually looks like, whereas a host that refuses connections proves something about that host.
 *
 * So it needs one server — this console — and the API behind it, exactly like the other browser proofs.
 *
 * Run, with the console and the API up:
 *   OPS_WEB_URL=http://localhost:5175 OPS_EMAIL=… OPS_PASSWORD=… \
 *   node apps/frontends/control-tower/scripts/verify-map-fallback.mjs
 *
 * `OPS_EMAIL` / `OPS_PASSWORD` default to the seeded network operator, and to anything an operator
 * should be signing in as: this proof is about what the console renders, not about who may see it, and
 * it wants the *seeded* hubs and riders because those are the markers it counts.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core').then(
  (m) => m.default ?? m,
);
import fs from 'node:fs';

// `OPS_WEB_URL` first, for the same reason `verify-tracking.mjs` reads `TRACKING_WEB_URL`: `prove:browser`
// runs four proofs against four origins, and a bare `WEB_URL` left over from one of the others would
// point this at the merchant console and fail on a selector that means nothing here.
const WEB = process.env.OPS_WEB_URL ?? process.env.WEB_URL ?? 'http://localhost:5175';
// A 1x1 PNG, served as a *fulfilled* response. The point of the healthy case is that the browser
// receives a 200 and fires onLoad — stubbing that in JS would prove the handler runs without proving
// the browser fires it, which is the half that can break.
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
// The seeded network operator, unless told otherwise. This is the one browser proof that needs a
// credential at all, and it wants the seeded one: the assertions count hubs and riders, so it needs the
// seed's data, and signing in as somebody the seed minted is how a demo environment is meant to be
// looked at.
const EMAIL = process.env.OPS_EMAIL ?? process.env.SEED_OPS_EMAIL;
const PASSWORD = process.env.OPS_PASSWORD ?? process.env.SEED_OPS_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error(
    [
      'No operator to sign in as.',
      '',
      '  This proof renders the console, so it needs a session. Source the seed credentials:',
      '',
      '    eval "$(pnpm db:seed | sed -n "/^export /p")"',
      '',
      '  or set OPS_EMAIL and OPS_PASSWORD to any network operator.',
    ].join('\n'),
  );
  process.exit(2);
}
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

/**
 * Photograph the fallback, if anybody asked for it.
 *
 * The same rule as the hub console's proof: `control-tower/scripts/shots.mjs` builds the gallery and
 * this is a set of assertions, so the picture is opt-in via `PROOF_SHOTS=1`.
 *
 * Only the fallback is photographed. The other two cases here replace the tile images with a 1×1 PNG,
 * so what they render is a map-shaped hole in a solid colour — accurate about the behaviour and useless
 * as a picture of the product. A gallery is a memory of how the software looks, and this one screen is
 * a real screen: a list of riders, because the basemap is gone.
 */
const WANT_SHOTS = process.env.PROOF_SHOTS === '1';

async function shot(page, name) {
  if (!WANT_SHOTS) return;
  const file = `${OUT}${process.env.SHOT_DATE ?? new Date().toISOString().slice(0, 10)}_ops_${name}.png`;
  await page.screenshot({ path: file });
  console.log(`shot  ${file}`);
}

/**
 * Sign in, and do not click until the app can hear it.
 *
 * The `networkidle` wait is the load-bearing line and it was missing, which made this proof a coin
 * flip: on a warm dev server the click landed after hydration and the sign-in worked, and on a cold one
 * it landed before and nothing at all happened. Not "a wrong page" — nothing. No `POST /v1/auth/login`,
 * no session cookie, and a URL that sits on `/login?` because TanStack Router has not taken over yet.
 *
 * The failure then surfaced thirty lines away as a `waitForURL` timeout on the line after the click,
 * which reads as *the app is broken* — on a machine where the app was fine and the proof was early. So
 * the wait is here, and so is the diagnosis in the timeout, because a proof that fails with a
 * misleading message costs more than one that fails.
 */
async function signIn(page) {
  await page.goto(`${WEB}/`);
  await page.waitForURL('**/login', { timeout: 15000 });
  // Hydration is not a visual state, so there is nothing to wait for by appearance; it is the absence
  // of outstanding requests, which is what `networkidle` means. The hub console's proof does the same
  // for the same reason.
  await page.waitForLoadState('networkidle');
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  try {
    await page.waitForURL(`${WEB}/`, { timeout: 15000 });
  } catch (error) {
    const said = await page
      .locator('form p, [role=alert]')
      .allInnerTexts()
      .catch(() => []);
    throw new Error(
      [
        `signed-in navigation never arrived — still at ${page.url()}`,
        said.length > 0 ? `the form said: ${said.join(' | ')}` : 'the form said nothing at all',
        'a bare `/login?` with no visible error is a click that landed before hydration, or bad',
        'credentials; anything else is a genuine sign-in failure worth reading the console for.',
      ].join('\n'),
      { cause: error },
    );
  }
}

// --- the healthy case first: markers exist and the map is on screen ---------------------------
// Selectors, because this is the proof most likely to be wrong about the UI rather than about the
// behaviour: they were written for a hand-rolled SVG map with `data-marker` attributes and an
// `aria-label` of "hubs, N riders", and the console has since moved to Leaflet, which draws
// `divIcon`s. So they are assertions about this implementation — `.leaflet-container`, `.zz-hub-icon`,
// the badge text — and the behaviour underneath them is what actually matters.
//
// Every one of them fails loudly rather than silently passing. A marker count of zero fails the
// `> 0` check below instead of quietly satisfying an `=== 0` written for a different DOM.
const ok = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await ok.route('**/*.png', (route) =>
  route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
);
await signIn(ok);
await settle(ok);

const hubMarkers = await ok.locator('.zz-hub-icon').count();
const riderMarkers = await ok.locator('.zz-rider-icon').count();
const tilesDrawn = await ok.locator('img.leaflet-tile').count();

check('the map renders', (await ok.locator('.leaflet-container').count()) === 1);
check(
  'and it has a basemap under the markers, not an empty frame',
  tilesDrawn > 0,
  `${tilesDrawn} tiles`,
);
check('hubs are drawn', hubMarkers > 0, `${hubMarkers}`);
check('riders with a position are drawn', riderMarkers > 0, `${riderMarkers}`);

// The footer states the counts in text, so the numbers a reader sees and the number of dots on screen
// are the same claim made twice. If those two ever disagree the screen is lying about one of them,
// and this is the assertion that catches it.
const footer = await ok.locator('main').innerText();
check(
  'the stated hub count is the number of hubs drawn',
  new RegExp(`${hubMarkers} hubs`).test(footer),
  footer.slice(0, 160),
);
check(
  'and the stated rider count is the number of riders drawn',
  new RegExp(`${riderMarkers} riders live`).test(footer),
  footer.slice(0, 160),
);

// --- the exit check: every tile dead -------------------------------------------------------
const dead = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// Every tile connection refused, exactly as a dead CDN would be from the browser.
await dead.route('**/*.png', (route) => route.abort('connectionrefused'));
await signIn(dead);
await dead.waitForSelector('text=/Showing the list instead/', { timeout: 20000 });
check('the map falls back to the list on its own', true);
check('with no operator action — the button was never pressed', true);
const reason = await dead.locator('text=/Showing the list instead/').innerText();
check('and it says WHY, in a sentence', /basemap did not load/i.test(reason), reason);
// The count is the part that saves an operator an hour: "it said 17 tiles failed" is a report, "the
// basemap did not load" sends them to the network team.
check('the count of dead tiles is in the reason', /\d+ tiles? failed/.test(reason), reason);
check(
  'the map is gone, not dimmed behind the list',
  (await dead.locator('.leaflet-container').count()) === 0,
);
check(
  'and no tile image is left on screen pretending to be a map',
  (await dead.locator('img.leaflet-tile').count()) === 0,
);

// The list must actually carry the data. A fallback that renders an empty table is not a fallback.
const listText = await dead.locator('main').innerText();
// The fallback must be a SUPERSET of the map, never smaller. The map drops markers it cannot place
// honestly; a list has no frame to be outside of, so it keeps them — and says how many those were.
const hubHeading = /Hubs \((\d+)\)/.exec(listText);
const riderHeading = /Riders \((\d+)\)/.exec(listText);
const listedHubs = hubHeading === null ? -1 : Number(hubHeading[1]);
const listedRiders = riderHeading === null ? -1 : Number(riderHeading[1]);
check(
  'the fallback never loses hubs relative to the map',
  listedHubs >= hubMarkers,
  `list ${listedHubs}, map drew ${hubMarkers}`,
);
check(
  'and never loses riders either',
  listedRiders >= riderMarkers,
  `list ${listedRiders}, map drew ${riderMarkers}`,
);
check(
  'and when the map dropped markers, the list says so rather than silently differing',
  listedHubs === hubMarkers && listedRiders === riderMarkers
    ? true
    : /could not be drawn/.test(listText),
  `hubs ${listedHubs}/${hubMarkers}, riders ${listedRiders}/${riderMarkers}, explained: ${/could not be drawn/.test(listText)}`,
);
check(
  'with coordinates, because a row of names is not a position',
  /\d+\.\d{4}, \d+\.\d{4}/.test(listText),
);
check(
  'and a live/stale badge, so a stale rider does not read as live',
  /\b(live|stale)\b/.test(listText),
);
// The fallback is the view an operator gets when things have already gone wrong. A row answering with
// `ON_PICKUP` — the raw wire value — turns one outage into two, and this row used to do exactly that
// while its sibling tooltip in the map had already been fixed.
check(
  'no raw enum leaks into the fallback rows',
  /\b(ON_PICKUP|ON_DELIVERY|PICKED_UP|IN_TRANSIT|DELIVERED|ASSIGNED|OUT_FOR_DELIVERY)\b/.test(
    listText,
  ) === false,
  (/\b(ON_PICKUP|ON_DELIVERY|PICKED_UP|IN_TRANSIT|DELIVERED|ASSIGNED|OUT_FOR_DELIVERY)\b/.exec(
    listText,
  ) ?? [''])[0],
);
await shot(dead, 'map_fallback');

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
await partial.waitForTimeout(2500);
check(
  'a single dead tile does not collapse the console into a list',
  (await partial.locator('.leaflet-container').count()) === 1 &&
    (await partial.locator('.zz-hub-icon').count()) > 0,
  `container ${await partial.locator('.leaflet-container').count()}, hubs ${await partial.locator('.zz-hub-icon').count()}`,
);
check(
  'and every rider marker is still there after the failure, not replaced by a notice',
  (await partial.locator('.zz-rider-icon').count()) === riderMarkers,
  `${await partial.locator('.zz-rider-icon').count()} of ${riderMarkers}`,
);
// A missing tile is still a thing that happened. Silent is how an operator ends up trusting a map with
// a hole in it, because nothing ever said there was one.
const partialText = await partial.locator('main').innerText();
check(
  'and the missing tile is stated rather than silently patched over',
  /1 tile did not load/.test(partialText),
  partialText.slice(0, 200),
);
check(
  'while saying the positions themselves are still right',
  /positions are still correct/i.test(partialText),
  partialText.slice(0, 200),
);

await browser.close();
console.log(
  failures.length === 0
    ? `\nstage 5 map fallback: ${passed} assertions ok`
    : `\n${failures.length} failure(s) of ${passed + failures.length}:\n  ${failures.join('\n  ')}`,
);
process.exit(failures.length === 0 ? 0 : 1);
