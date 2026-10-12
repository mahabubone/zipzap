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
  // Leaflet draws its tile layer and then places markers, and neither is synchronous with
  // `networkidle` — the tiles are `<img>` elements loaded after the container mounts, and the
  // markers are React effects that run after the tile layer is in the DOM. A fixed 500ms caught
  // this once and then failed on a cold cache, so the count is polled instead: the shot waits until
  // the map has actually drawn something, or times out loudly.
  await page.waitForFunction(
    () => document.querySelectorAll('.leaflet-marker-icon').length > 0,
    undefined,
    { timeout: 20000 },
  );
  await page.waitForTimeout(600);
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
  const file = `${OUT}${DATE}_ops_${name}.png`;
  await page.screenshot({ path: file, fullPage });
  console.log(`shot  ${file}`);
}

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`${APP}/login`);
// NOT `settle`. That waits for Leaflet markers, and the login page has none — the shot would time
// out before the form was ever touched, which is exactly what it did the first time the map gained
// a real tile layer.
await page.waitForLoadState('networkidle');
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 });
// Now the map is up and `settle` means what it says.
await settle(page);

// Fail loudly rather than photograph the error box. A shot that says PERMISSION_DENIED is a false
// record of what the product looks like, and worse than no shot at all.
const body = await page.locator('body').innerText();
if (body.includes('Something went wrong') || body.includes('PERMISSION_DENIED')) {
  throw new Error('control tower rendered an error — check the ops account has network:read');
}

await shoot(page, 'network_map');

// Zoomed to Dhaka at the scale an operator actually works at.
//
// The default fit-bounds view fits the whole network, which shows the reach and hides what the
// screen is opened for: which riders are near which hub right now. Two clicks on the real zoom
// control rather than reaching into Leaflet's internals — the container does not expose its map
// instance, and a `flyTo` on `undefined` fails silently and leaves the identical view, which is how
// the first version of this shot ended up being a second copy of the full-network one.
const zoomIn = page.locator('.leaflet-control-zoom-in');
for (let i = 0; i < 2; i++) {
  await zoomIn.click();
  await page.waitForTimeout(350);
}
// Pan so Dhaka — where the density is — sits centred rather than at the edge of a zoomed frame.
await page.mouse.move(700, 450);
await page.mouse.wheel(0, 120);
await page.waitForTimeout(900);
await shoot(page, 'network_map_dhaka');

// The list the map falls back to. Worth its own shot: the fallback is a decision (see
// docs/ADR/0011-postgis.md and the map's own header), and a decision nobody can see is a decision
// nobody will believe was made.
const markers = await page.locator('.leaflet-marker-icon').count();
console.log(`      ${markers} markers on the basemap`);
const hubs = await page.locator('text=/hubs/').count();
if (hubs > 0) {
  const footer = await page.locator('body').innerText();
  const match = /(\d+) hubs/.exec(footer);
  if (match) console.log(`      ${match[1]} hubs reported by the screen`);
}
const suppressed = await page.locator('text=/too close to label/').count();
if (suppressed > 0) {
  // Not a failure — an honest report. The footer counts what it could not label rather than
  // silently dropping them, and that behaviour is worth stating out loud in the run log.
  console.log('      note: some hub labels were suppressed for lack of room');
}

// The third ops shot: a marker's detail, open. A map of dots is a picture; the reason an operator
// opens this screen is to read ONE dot — who it is, what they are doing, when they last checked
// in — and none of that is visible until a marker is hovered. Capturing it closed would be
// photographing the map without the part that does the work.
const riderMarker = page.locator('.leaflet-marker-icon').first();
if ((await riderMarker.count()) > 0) {
  await riderMarker.hover();
  await page.waitForTimeout(700);
  await shoot(page, 'network_map_rider_detail');
} else {
  console.log('skip  network_map_rider_detail (no markers drawn)');
}

await browser.close();
