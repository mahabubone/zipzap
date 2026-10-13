/**
 * Stage 3 browser proof — the four exit checks in docs/product/competition/plan.md, in a real
 * browser at a real 5" phone viewport.
 *
 * The API layer already proves the machine refuses an out-of-order scan. What it cannot prove is
 * whether an operator at a belt can *see* that refusal. So the load-bearing assertions here are
 * about the DOM: a refusal rendered in full, and targets big enough for a gloved thumb.
 *
 * ## The refusals are provoked the way they actually happen
 *
 * Not by hand-injecting markup, and not by a picker the screen does not have. The hub screen only
 * ever offers the server's own next gesture, so an out-of-order scan is unreachable *by design* —
 * which is exit check one, not a dodge around it. What does happen in a depot is a stale screen:
 * two operators share a hub, one's tablet was in a pocket for four minutes, and its button still
 * names a gesture the parcel has long since passed. Every refusal below is that, and the 409 comes
 * from the real server through the real click handler.
 *
 * ## Dependencies, both borrowed and neither declared
 *
 * `playwright-core` and `pg` come from the machine, not from this package. A proof script must not
 * add a runtime dependency to the web app, and a frontend must not depend on a database driver —
 * rule 2 says the browser never crosses a schema boundary, and a proof that reached into
 * `shipment.shipments` to build its fixture would be doing the same thing for the wrong reason. The
 * fixture writes directly because there is no API for "create a parcel that is already PICKED_UP",
 * which is a fixture concern and not a product gap.
 *
 * `pg` resolves from the backend workspace via PG (below), so this works without anything installed
 * here. Same convention as merchant-web/scripts/shots.mjs.
 *
 * Run: API_URL=http://localhost:3005 WEB_URL=http://127.0.0.1:5177 \
 *      PG=../../backend/node_modules/pg/esm/index.mjs \
 *      node apps/frontends/hub-console/scripts/verify-console.mjs
 */
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core').then(
  (m) => m.default ?? m,
);
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

// The backend's own pg, by default: it is already a workspace dependency there and adding it here
// would put a database driver in a browser app's dependency tree.
const pg = (await import(process.env.PG ?? '../../../backend/node_modules/pg/esm/index.mjs')).default;
const { hashSecret } = await import(
  new URL('../../../backend/dist/common/secret.js', import.meta.url).pathname
);

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5177';
const API = process.env.API_URL ?? 'http://localhost:3000';

// 375x812 is what a current 5" Android reports in CSS pixels. Width is the axis that matters: it is
// what a gloved thumb and a work list fight over.
const PHONE = { width: 375, height: 812 };

const OUT = new URL('../../../../shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

let passed = 0;
const failures = [];
function check(label, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}
function eq(label, actual, expected) {
  check(label, actual === expected, `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// ------------------------------------------------------------------ fixture
//
// Built here rather than in the backend script so this file is one command. A hub operator whose
// ONLY power is hub:scan, plus the three parcels the exit checks need.
const runTag = Date.now().toString(36);
const merchantId = randomUUID();
const email = `hubui+${runTag}@example.test`;
const password = `zz_${createHash('sha256').update(`${runTag}pw`).digest('hex').slice(0, 18)}`;

await client.query(
  `INSERT INTO merchant.merchants (id, name, status, contact_email) VALUES ($1,$2,'ACTIVE',$3)`,
  [merchantId, 'Stage 3 Hub Console Fixture', email],
);
const userId = randomUUID();
await client.query(`INSERT INTO identity.users (id, email, password_hash) VALUES ($1,$2,$3)`, [
  userId,
  email,
  await hashSecret(password),
]);
await client.query(
  `INSERT INTO identity.user_merchants (user_id, merchant_id, role) VALUES ($1,$2,'HUB_OPERATOR')`,
  [userId, merchantId],
);

/** A parcel in PICKED_UP, so INBOUND is the legal first gesture. */
async function parcel(label) {
  const id = randomUUID();
  const code = `ZP-H${runTag.toUpperCase()}${label}`;
  await client.query(
    `INSERT INTO shipment.shipments
       (id, tracking_code, merchant_id, sender_name, sender_phone, sender_address,
        recipient_name, recipient_phone, recipient_address, parcel_weight_grams,
        parcel_description, status, cod_amount_minor, cod_currency,
        pricing_version, zone, created_at, updated_at)
     VALUES ($1,$2,$3,'Sender','+8801700000000','Dhaka','Recipient','+8801800000000','Dhaka',
             500,'Box','PICKED_UP',0,'BDT',1,'dhaka-metro', now(), now())`,
    [id, code, merchantId],
  );
  return { id, code };
}

// Four parcels, four jobs. An earlier draft used one parcel for two of them and the proof caught it
// as a phantom `missingCount` — the "never scanned in" parcel had been walked out of band by the
// stale-screen section, so the manifest had nothing actually missing. Distinct fixtures, or the
// assertions stop meaning what they say.
const driven = await parcel('D'); // the belt gestures, clicked in the UI
const stale = await parcel('S'); // walked to the end out of band, so it reads Done
const lagging = await parcel('L'); // the stale screen: its button goes out of date
const absent = await parcel('A'); // never walked, so it is genuinely the missing parcel

const hub = (await client.query(`SELECT code, name FROM hub.hubs ORDER BY code LIMIT 1`)).rows[0];
const HUB = hub.code;

const session = await fetch(`${API}/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
}).then((r) => r.json());
check('the fixture hub operator can sign in', Boolean(session.token), true);

const auth = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };

/** The second operator's tablet: same token, out of band. */
async function otherScan(shipmentId, scan) {
  const res = await fetch(`${API}/v1/hubs/scans`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ shipmentId, scan, hubCode: HUB }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function api(path, method = 'GET', body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: auth,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// All three into the hub, so one work list holds the whole proof.
for (const p of [driven, stale, lagging, absent])
  eq(`${p.code} scans in`, (await otherScan(p.id, 'INBOUND')).status, 201);

// ------------------------------------------------------------------ browser
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});

async function settle(page) {
  await page.waitForLoadState('networkidle');
  // A click before React hydrates falls through to a native form submit.
  await page.waitForFunction(() => !document.querySelector('main .animate-pulse'), { timeout: 15000 });
  await page.waitForTimeout(250);
}
async function shoot(page, name) {
  const file = `${OUT}2026-10-09_hub_${name}.png`;
  await page.screenshot({ path: file });
  console.log(`shot  ${file}`);
}
/** The work-list row for one parcel. */
const row = (page, code) => page.locator('main ul li', { hasText: code });
/** One manifest cargo row. Scoped to the cargo list because the exception banner repeats the ids
 *  in a second <ul>, and an unscoped `main li` matches both. */
const cargoRow = (page, id) =>
  page.locator('main > ul li', { hasText: id.slice(0, 8) }).last();

const page = await browser.newPage({ viewport: PHONE, deviceScaleFactor: 2 });

// --- sign in -----------------------------------------------------------------------------------
await page.goto(`${WEB}/`);
await settle(page);
check('the console root sends an anonymous visitor to sign in', page.url().endsWith('/login'), page.url());

await page.fill('#email', email);
await page.fill('#password', password);
await page.click('button[type=submit]');
await page.waitForURL(`${WEB}/`, { timeout: 15000 });
await settle(page);
eq('the hub operator lands on the hub picker', (await page.locator('h1').innerText()).trim(), 'Choose your hub');

// --- the picker ---------------------------------------------------------------------------------
const hubs = (await api('/v1/hubs')).body;
const rowCount = await page.locator('main ul li').count();
eq('one row per hub, none dropped', rowCount, hubs.length);

// Busiest-first is the claim the screen makes; assert it rather than trust the sort.
const counts = (await page.locator('main ul li').allInnerTexts()).map((t) => {
  const m = t.match(/(\d+) waiting/);
  return m ? Number(m[1]) : -1;
});
check('every row states its count', counts.every((n) => n >= 0), JSON.stringify(counts));
check(
  'the busiest hub is first, because that is the room you are standing in',
  counts.every((n, i) => i === 0 || counts[i - 1] >= n),
  JSON.stringify(counts),
);
await shoot(page, 'picker_phone');

const busiest = hubs.reduce((a, b) => (b.countAtHub > a.countAtHub ? b : a));
await page.locator(`main ul li a[href*="${busiest.code}"]`).first().click();
await page.waitForURL(/\/hubs\//, { timeout: 15000 });
await settle(page);
eq('the chosen hub is the one on screen', (await page.locator('h1').innerText()).trim(), busiest.name);

// --- exit check 4: gloves on a 5" phone -------------------------------------------------------
const targets = await page.evaluate(() =>
  [...document.querySelectorAll('main ul li button')].map((b) => {
    const r = b.getBoundingClientRect();
    return { text: b.innerText.trim(), h: Math.round(r.height), w: Math.round(r.width) };
  }),
);
check('the hub has parcels to scan', targets.length > 0, `${targets.length} targets`);
check(
  'every scan target is at least 48px tall — a gloved thumb, not a cursor',
  targets.every((t) => t.h >= 48),
  JSON.stringify(targets.filter((t) => t.h < 48)),
);
check(
  'every scan target is at least 88px wide',
  targets.every((t) => t.w >= 88),
  JSON.stringify(targets.filter((t) => t.w < 88)),
);

// Horizontal scroll on a work list means a row is half off-screen and the operator does not know it.
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - window.innerWidth,
);
check('no horizontal overflow at 375px', overflow <= 1, `${overflow}px`);

// The primary action is the scan, and it is the largest thing on the page.
const biggest = [...targets].sort((a, b) => b.h * b.w - a.h * a.w)[0];
check('the primary action is a scan', /^Scan /.test(biggest.text), JSON.stringify(biggest));

// The tracking code must be readable at arm's length on a phone in a warehouse.
const codeSize = await row(page, driven.code)
  .locator('p')
  .first()
  .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
check('the tracking code is at least 16px — read at a belt, not squinted at', codeSize >= 16, `${codeSize}px`);
await shoot(page, 'worklist_phone');

// --- exit check 2, part 1: the belt gestures, every one clicked in the UI ----------------------
// The button is the server's own next gesture, so walking the cycle is one round trip per gesture:
// the list is refetched and the button re-reads after each one. If the label ever stops advancing,
// the work list and the machine have drifted — which is the bug this screen exists to prevent.
//
// Four gestures, not five, and that is a finding rather than an omission. DEPARTED removes the
// parcel from `hub.parcel_presence` — it has left this building — so it is on no hub's work list
// afterwards, and ARRIVED is the one gesture the belt screen structurally cannot offer. It is
// recorded from the manifest instead, which is the only screen that still knows the parcel is
// expected. Part two walks it.
const BELT = ['sort', 'outbound', 'departed'];
const seen = [];
for (const verb of BELT) {
  const button = row(page, driven.code).locator('button');
  eq(`${driven.code} offers "Scan ${verb}" next`, (await button.innerText()).trim(), `Scan ${verb}`);
  seen.push(verb);
  await button.click();
  await page.waitForTimeout(700);
}
check('every belt gesture was a distinct button', new Set(seen).size === BELT.length, JSON.stringify(seen));
eq(
  'the parcel is in line-haul, which is what DEPARTED means',
  (await client.query(`SELECT status FROM shipment.shipments WHERE id = $1`, [driven.id])).rows[0].status,
  'IN_TRANSIT',
);
check(
  'and it has left this hub\'s work list, because it left this building',
  (await row(page, driven.code).count()) === 0,
);
// A parcel past its last hub gesture must read Done, not offer a button that will 409. `stale` is
// the one that gets walked to the end.
for (const kind of ['INBOUND', 'SORT', 'OUTBOUND', 'DEPARTED', 'ARRIVED']) await otherScan(stale.id, kind);
await page.click('button[aria-label="Refresh work list"]');
await page.waitForTimeout(700);
check(
  'a parcel with no further hub gesture reads Done, not a button that would 409',
  (await row(page, stale.code).innerText()).includes('Done'),
);

// --- exit check 1: an out-of-order scan, refused on screen -----------------------------------
// The stale screen, made real. This work list was fetched before the line above walked `lagging` to
// the far end on another tablet; its button still names a gesture the parcel has long since passed.
eq('the stale screen still offers the old gesture', (await row(page, lagging.code).locator('button').innerText()).trim(), 'Scan sort');
for (const kind of ['SORT', 'OUTBOUND', 'DEPARTED', 'ARRIVED']) await otherScan(lagging.id, kind);

await row(page, lagging.code).locator('button').click();
await page.waitForSelector('[role=alert]', { timeout: 10000 });
const banner = page.locator('[role=alert]');
check('the refusal is on screen, not only in the log', await banner.isVisible());
const bannerText = await banner.innerText();
check('the refusal says it was refused', /refused/i.test(bannerText), bannerText);
// The whole diagnosis is this sentence. Paraphrasing it would leave the operator with nothing to act
// on, so it is asserted verbatim — both the state the parcel was in and the one the scan wanted.
check(
  'the refusal names the state the parcel was in and the one the scan wanted',
  /AT_DESTINATION_HUB/.test(bannerText) && /SORTING/.test(bannerText),
  bannerText,
);
// And it must not be a raw enum dump with no English around it.
check('the refusal reads as a sentence, not an enum', /Scan refused/.test(bannerText), bannerText);
await shoot(page, 'refusal_phone');

// Refreshing is the operator's next move, and it must clear the stale row.
await page.click('button[aria-label="Refresh work list"]');
await page.waitForTimeout(700);
check('refreshing clears the stale gesture', (await row(page, lagging.code).innerText()).includes('Done'));

// The same parcel through the API, to prove the UI was not merely catching an error of its own.
eq(
  'and the server refused that same scan for the same stated reason',
  (await otherScan(lagging.id, 'SORT')).status,
  409,
);

// --- exit check 3: a manifest missing a shipment raises a visible exception -------------------
// The manifest is fixture setup (a trip and a cargo list), but every edge is clicked in the UI — the
// exit check is that reconciliation *refuses visibly*, not that it refuses.
const trip = await api('/v1/manifests/trips', 'POST', { routeCode: 'DAC-CGP-LH' });
eq('a trip is scheduled on a seeded route', trip.status, 201);
const manifest = await api('/v1/manifests', 'POST', {
  tripId: trip.body.tripId,
  shipmentIds: [driven.id, stale.id, lagging.id, absent.id],
});
eq('a manifest is created over four parcels', manifest.status, 201);
const manifestId = manifest.body.id;

await page.goto(`${WEB}/manifests/${manifestId}`);
await settle(page);
await shoot(page, 'manifest_detail_phone');

const exceptionBefore = await page.locator('main').innerText();

// A DRAFT manifest has nobody having looked at it yet, so the screen must claim nothing about its
// cargo — not "3 expected" as a warning, not an exception. 277 seeded manifests would all be red.
check(
  'a DRAFT manifest claims nothing about its cargo',
  !exceptionBefore.includes('have not arrived') && !exceptionBefore.includes('Reconcile'),
  exceptionBefore.slice(0, 200),
);
check(
  'and says so per row, in expectation rather than as a failure',
  exceptionBefore.includes('Expected'),
  exceptionBefore.slice(0, 300),
);

const EDGES = ['Seal manifest', 'Dispatch', 'Receive'];
for (const label of EDGES) {
  const button = page.locator('main button', { hasText: label });
  eq(`the ${label.toLowerCase()} button is offered`, await button.count(), 1);
  await button.click();
  await page.waitForTimeout(600);
}
check('the manifest is now Received', (await page.locator('main').innerText()).includes('Received'));
await shoot(page, 'manifest_received_phone');

// --- exit check 2, part 2: the arrival gesture, from the screen that can still see it ----------
const arrivedBefore = (await api(`/v1/manifests/${manifestId}`)).body.missingCount;
eq('two parcels have not arrived when the manifest is received', arrivedBefore, 2);
await cargoRow(page, driven.id).locator('button', { hasText: 'Record arrival' }).click();
await page.waitForTimeout(800);
eq(
  'recording an arrival moves the parcel to the destination hub',
  (await client.query(`SELECT status FROM shipment.shipments WHERE id = $1`, [driven.id])).rows[0].status,
  'AT_DESTINATION_HUB',
);
eq('and recording one leaves one', (await api(`/v1/manifests/${manifestId}`)).body.missingCount, 1);
check(
  'an arrived parcel is badged Arrived rather than offered another arrival',
  (await cargoRow(page, driven.id).innerText()).includes('Arrived'),
);
await shoot(page, 'manifest_arrival_phone');

// `stale` and `lagging` were walked to AT_DESTINATION_HUB out of band, so they count as arrived
// too. Only `absent` is genuinely missing — it was scanned in and never moved.
const detail = (await api(`/v1/manifests/${manifestId}`)).body;
eq('three of four parcels arrived, one did not', detail.missingCount, 1);
check(
  'the machine names the parcel it is waiting on, so the refusal is actionable',
  (await api(`/v1/manifests/${manifestId}/reconcile`, 'POST')).body?.detail?.includes(
    absent.id.slice(0, 8),
  ) ?? false,
);

const exceptionText = await page.locator('main').innerText();
check(
  'a missing parcel raises a visible exception, not a log line',
  /1 of 4 parcels have not arrived/.test(exceptionText),
  exceptionText.slice(0, 240),
);
check('the exception names the parcel that has not arrived', exceptionText.includes(absent.id.slice(0, 8)));
check(
  'the cargo row offers an arrival rather than only counting the parcel',
  (await cargoRow(page, absent.id).innerText()).includes('Record arrival'),
);
// The screen must not claim the parcel is lost. It knows what was on the truck and what has been
// checked in; it does not know what happened in between.
check(
  'it says "not arrived", not "missing" — a manifest cannot know a parcel was lost',
  !/\bmissing\b/i.test(exceptionText),
  exceptionText.slice(0, 200),
);
await shoot(page, 'manifest_exception_phone');

const reconcile = page.locator('main button', { hasText: 'Reconcile' });
eq('reconcile is still offered, because the exception is a state not a verdict', await reconcile.count(), 1);
await reconcile.click();
await page.waitForSelector('[role=alert]', { timeout: 10000 });
check(
  'reconciling with a parcel that has not arrived is refused on screen',
  /Refused/.test(await page.locator('[role=alert]').innerText()),
);
check(
  'and the refusal names the parcels it is waiting on',
  /\b1\b/.test(await page.locator('[role=alert]').innerText()),
);
await shoot(page, 'manifest_reconcile_refused_phone');
eq(
  'the manifest stayed Received',
  (await api(`/v1/manifests/${manifestId}`)).body.status,
  'RECEIVED',
);

// The retry after the parcel shows up. This is the assertion that matters: an exception that never
// clears is a dead queue, and the button must still work without the operator reloading anything.
for (const kind of ['SORT', 'OUTBOUND', 'DEPARTED', 'ARRIVED']) await otherScan(absent.id, kind);
await page.locator('main button', { hasText: 'Reconcile' }).click();
await page.waitForTimeout(900);
check(
  'the same reconcile passes once the parcel arrives',
  (await page.locator('main').innerText()).includes('Reconciled'),
);
check(
  'and a reconciled manifest offers no further edge, because there is none',
  (await page.locator('main button').count()) === 0,
);
await shoot(page, 'manifest_reconciled_phone');

// --- the list, and the two screens that are not phone-shaped ----------------------------------
await page.goto(`${WEB}/manifests`);
await settle(page);
check('the manifest list renders rows', (await page.locator('main ul li').count()) > 0);
check(
  'a raw enum never reaches the manifest list',
  !/DRAFT|SEALED|RECEIVED\b/.test(await page.locator('main').innerText()),
);
await shoot(page, 'manifests_phone');

const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await desk.goto(`${WEB}/`);
await settle(desk);
await desk.screenshot({ path: `${OUT}2026-10-09_hub_picker_desktop.png`, fullPage: true });
await desk.goto(`${WEB}/hubs/${HUB}`);
await settle(desk);
await desk.screenshot({ path: `${OUT}2026-10-09_hub_worklist_desktop.png`, fullPage: true });
check(
  'no horizontal overflow at 1280px either',
  (await desk.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1,
);

await browser.close();
await client.end();

console.log(
  failures.length === 0
    ? `\nstage 3 hub console: ${passed} assertions ok`
    : `\n${failures.length} failure(s) of ${passed + failures.length}:\n  ${failures.join('\n  ')}`,
);
process.exit(failures.length === 0 ? 0 : 1);