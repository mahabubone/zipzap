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
 * The hub code is READ from the app rather than hardcoded. Since Phase B there is no picker: `/`
 * resolves `GET /v1/hubs/my-hub` and lands on the one hub this person is assigned to. A literal here
 * would have photographed Chattogram — a real hub, not the one this login works at — and the
 * difference is invisible until you read the header.
 *
 * Run: node apps/frontends/hub-console/scripts/shots.mjs
 * Needs: SEED_HUB_EMAIL / SEED_HUB_PASSWORD (from `pnpm db:seed`), and this app's dev server.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core').then(
  (m) => m.default ?? m,
);
import fs from 'node:fs';

const APP = process.env.APP_URL ?? 'http://localhost:5176';
const EMAIL = process.env.SEED_HUB_EMAIL;
const PASSWORD = process.env.SEED_HUB_PASSWORD;
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

// `/` → `/my-hub` → `/hubs/<assigned>`. Wait for that chain rather than for a URL we guessed: the
// code is only known once the app has asked the server which hub this person works at, and reading
// it back off `page.url()` is the same answer the console itself is rendering.
await page.waitForURL(/\/hubs\/[^/]+/, { timeout: 20000 });
await settle(page);

const HUB_CODE = /\/hubs\/([^/]+)/.exec(page.url())?.[1];
if (!HUB_CODE) throw new Error(`login did not land on a hub — still at ${page.url()}`);
console.log(`      assigned hub: ${HUB_CODE}`);

/**
 * Visit a route, refuse to photograph it if it is lying, then shoot it.
 *
 * An empty work list and a permission error both render cleanly, and both are false records: the
 * work list exists to show parcels awaiting a scan, and a 403 box next to a hub name is a broken
 * app. The failure modes are different — a wrong account versus an unseeded database — so the
 * messages say so.
 *
 * The route is a parameter rather than a `page.goto` at the call site, because a version of this
 * script that navigated once and then shot twice produced two files of the same overview screen with
 * different names. A shot of the wrong screen is worse than no shot, because it looks like evidence.
 */
async function shootRoute(path, name, { requireScans = false } = {}) {
  await page.goto(`${APP}${path}`);
  await settle(page);
  const body = await page.locator('body').innerText();
  if (body.includes('Not assigned to a hub')) {
    throw new Error(
      'the hub operator has no assignment — run `pnpm seed:shots`, which places them where the work is',
    );
  }
  if (body.includes('Something went wrong') || body.includes('PERMISSION_DENIED')) {
    throw new Error(`${name} rendered an error — check the seeded hub account has hub:read`);
  }
  if (requireScans) {
    // `scanAction` renders exactly one button per parcel that can move: "Scan sort", "Scan outbound".
    // A parcel with nothing left to do renders a `Done` badge instead, so this counts work.
    const buttons = await page
      .getByRole('button', { name: /^scan (inbound|sort|outbound|departed|arrived)$/i })
      .count();
    if (buttons === 0) {
      console.log(`skip  hub_${name} (no parcels awaiting a scan at ${HUB_CODE})`);
      return;
    }
    console.log(`      ${buttons} parcels awaiting a scan`);
  }
  await shoot(page, name);
}

// The landing screen: four counts and the six-item sidebar. Worth a shot because it is the first
// thing an operator sees, and because the counts come from the same work list the next screen shows.
await shootRoute(`/hubs/${HUB_CODE}`, 'overview');

// The work list. The screen the console is for: one row per parcel, one button per row, and the
// button is the server's own answer about what that parcel needs next.
await shootRoute(`/hubs/${HUB_CODE}/work`, 'work', { requireScans: true });

// Manifests — the route reconciliation and outbound loads, which is the other half of a hub shift.
await shootRoute('/manifests', 'manifests');

await browser.close();
