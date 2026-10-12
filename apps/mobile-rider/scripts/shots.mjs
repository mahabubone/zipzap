/**
 * Captures the rider app screens into shots/mobile, per the repo's visual-memory
 * rule. Serves the local `expo export --platform web` bundle (run it first) and
 * stubs the API at the network boundary — so a shot that looks right means the
 * real components, the real queue states, and the real tab shell rendered.
 *
 * Stubbing, not fixtures in Postgres: the integration proof (verify-client.mjs)
 * already covers the client against the real wire. These shots cover what the
 * API layer cannot — whether a rider can *see* the queue, the rulings, and the
 * next action at a 5" phone viewport.
 *
 * playwright-core resolves from the machine, not from this package — a shot
 * script must not add a runtime dep to the app. Same convention as
 * merchant-web/scripts/shots.mjs and hub-console/scripts/verify-console.mjs.
 *
 * Run:  pnpm --filter @zipzap/rider exec expo export --platform web --output-dir dist-web
 *       node apps/mobile-rider/scripts/shots.mjs   (serves dist-web itself)
 */
const corePath = process.env.PLAYWRIGHT_CORE ?? 'playwright-core';
const coreUrl =
  corePath.startsWith('.') || corePath.startsWith('/')
    ? corePath.endsWith('.js')
      ? corePath
      : `${corePath}/index.js`
    : corePath;
const { chromium } = await import(coreUrl).then((m) => m.default ?? m);
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const DIST = new URL('../dist-web/', import.meta.url).pathname;
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(
    'dist-web/ missing — run `expo export --platform web --output-dir dist-web` first.',
  );
  process.exit(1);
}

const OUT = new URL('../../../shots/mobile/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

// 375x812 is what a current 5" Android reports in CSS pixels. Width is the axis
// that matters: it is what a gloved thumb and a job list fight over.
const PHONE = { width: 375, height: 812 };
// Derived, not hardcoded. It was a literal for three days, which meant the shots kept the old
// date prefix while being recaptured — and a date you cannot trust is worse than no date, because
// it tells you something about recency that is false.
const DAY = new Date().toISOString().slice(0, 10);

// --- static server for the export --------------------------------------------
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};
const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, 'http://x').pathname;
  const file = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath.slice(1));
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404);
      res.end('nope');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

// --- representative API states -------------------------------------------------
// One rider's day: two pickups (one collected, one waiting) and three deliveries
// (one fresh, one attempted once, one delivered). Amounts are integer poisha.
const JOBS = {
  pickups: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      merchantId: 'm-1',
      shipmentIds: ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'],
      riderId: 'rider-7',
      status: 'ASSIGNED',
      totalWeightGrams: 2000,
      createdAt: `${DAY}T06:10:00.000Z`,
    },
  ],
  deliveries: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      shipmentId: '55555555-5555-4555-8555-555555555555',
      shipment: {
        shipmentId: '55555555-5555-4555-8555-555555555555',
        codAmountMinor: 125050,
        codCurrency: 'BDT',
        recipientPhone: '+8801711223344',
        recipientName: 'Nafis Ahmed',
        recipientAddress: 'Plot 4, Road 12, Banani, Dhaka 1213',
      },
      riderId: 'rider-7',
      status: 'OUT_FOR_DELIVERY',
      attemptsMade: 0,
      lastFailureReason: null,
      createdAt: `${DAY}T06:30:00.000Z`,
    },
    {
      id: '66666666-6666-4666-8666-666666666666',
      shipmentId: '77777777-7777-4777-8777-777777777777',
      shipment: {
        shipmentId: '77777777-7777-4777-8777-777777777777',
        codAmountMinor: 0,
        codCurrency: 'BDT',
        recipientPhone: '+8801811998877',
        recipientName: 'Sabrina Karim',
        recipientAddress: 'Plot 4, Road 12, Banani, Dhaka 1213',
      },
      riderId: 'rider-7',
      status: 'OUT_FOR_DELIVERY',
      attemptsMade: 1,
      lastFailureReason: 'CUSTOMER_UNAVAILABLE',
      createdAt: `${DAY}T06:45:00.000Z`,
    },
    {
      id: '88888888-8888-4888-8888-888888888888',
      shipmentId: '99999999-9999-4999-8999-999999999999',
      shipment: {
        shipmentId: '99999999-9999-4999-8999-999999999999',
        codAmountMinor: 2375500,
        codCurrency: 'BDT',
        recipientPhone: '+8801716550011',
        recipientName: 'Rafiqul Islam',
        recipientAddress: 'Plot 4, Road 12, Banani, Dhaka 1213',
      },
      riderId: 'rider-7',
      status: 'DELIVERED',
      attemptsMade: 1,
      lastFailureReason: null,
      createdAt: `${DAY}T05:50:00.000Z`,
    },
  ],
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});

const page = await browser.newPage({ viewport: PHONE });

// Login succeeds; everything else answers from the fixtures above. The sync
// POST echoes `applied` per command, which is what the Sync screen shows.
await page.route('**/v1/**', async (route) => {
  const url = route.request().url();
  const json = (body) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.endsWith('/v1/auth/token') && route.request().method() === 'POST') {
    return json({
      token: 'shot-token',
      tokenType: 'Bearer',
      expiresInSeconds: 43200,
      expiresAt: `${DAY}T18:00:00.000Z`,
      merchantId: 'm-1',
      merchantIds: ['m-1'],
    });
  }
  if (url.includes('/v1/riders/') && url.includes('/jobs')) return json(JOBS);
  if (url.includes('/proof/code') && route.request().method() === 'POST') {
    return json({
      jobId: '66666666-6666-4666-8666-666666666666',
      status: 'PENDING',
      expiresAt: `${DAY}T09:24:00.000Z`,
      attemptsRemaining: 5,
      code: '4813',
    });
  }
  if (url.includes('/proof') && route.request().method() === 'POST') {
    return json({
      jobId: '66666666-6666-4666-8666-666666666666',
      proofId: '99999999-9999-4999-8999-999999999999',
      status: 'VERIFIED',
      photoSha256: 'f'.repeat(64),
      photoByteLength: 184320,
      otpVerifiedAt: `${DAY}T09:20:00.000Z`,
      replayed: false,
    });
  }
  if (url.endsWith('/v1/me')) {
    return json({
      kind: 'human',
      subjectId: 'rider-7',
      merchantId: null,
      merchantIds: [],
      scopes: ['rider:sync', 'delivery:complete'],
      credentialId: 'cred-1',
      rateLimitPerMin: null,
    });
  }
  if (url.endsWith('/sync/replay') && route.request().method() === 'POST') {
    const sent = route.request().postDataJSON()?.commands ?? [];
    return json({
      results: sent.map((c) => ({
        deviceSequence: c.deviceSequence,
        commandId: `cmd-${c.deviceSequence}`,
        kind: 'applied',
        reason: null,
      })),
      queueSize: 0,
      capWarning: false,
    });
  }
  return json({});
});

function shoot(name) {
  // `DAY`, not a literal. A hardcoded prefix here meant every recapture kept the date it was first
  // taken, so a reader could not tell a fresh shot from a three-day-old one.
  const file = `${OUT}${DAY}_rider_${name}.png`;
  return page.screenshot({ path: file }).then(() => console.log(`shot  ${file}`));
}

async function settle() {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
}

// The rider's handle is a phone number, not an email. The placeholder changed with it, and a shots
// script that still fills `rider@example.com` fails on the first field with a 30-second timeout
// rather than anything that looks like a login problem.
const phone = page.getByPlaceholder('01712345678');
const password = page.getByPlaceholder('••••••••');
const riderId = page.getByPlaceholder('The rider you are working as');

await page.goto(BASE);
await settle();
await shoot('auth');

await phone.fill('01712345678');
await password.fill('shot-password');
await riderId.fill('rider-7');
await page.getByRole('button', { name: 'Sign in' }).click();
await settle();
await shoot('jobs');

// First job card → detail. The pickup is newest, so detail shows the scan path.
await page.getByText(/Pickup 2 parcels/).click();
await settle();
await shoot('job-pickup');

// Queue a scan: the detail screen confirms with the device sequence.
await page
  .getByText('Parcel id')
  .locator('..')
  .getByRole('textbox')
  .fill('22222222-2222-4222-8222-222222222222');
await page.getByRole('button', { name: 'Queue pickup scan' }).click();
await page.waitForTimeout(600);
await shoot('job-pickup-queued');

// No manual back button: React Navigation's stack header renders one. Clicking it is the
// same interaction a rider makes, which is the point of using a real navigator.
// Back to the list. The tab bar's "Jobs" is the reliable target: the stack header's back arrow
// is an unlabelled icon, and pressing the tab pops the whole stack, which is what a rider does.
await page.getByRole('tab', { name: /^Jobs/ }).first().click();
await settle();
// The delivery with one prior attempt → reason chips + COD form.
await page.getByText(/Delivery 77777777/).click();
await settle();
await shoot('job-delivery');

// Queue a failed attempt with a reason chip, then show the confirmation.
// The failure path is now a supporting action under the primary one, expanded the way a rider
// expands it: one tap on "Or instead". The reason chips live behind it.
await page.getByText(/Customer not in/).click();
await page.getByText('CUSTOMER UNAVAILABLE').click();
await page.getByRole('button', { name: 'Queue failed attempt' }).click();
await page.waitForTimeout(600);
await shoot('job-attempt-queued');

// Proof of delivery: the code the customer reads out, then the photo, then the queue.
// Already on the delivery job from the attempt above, so the door opens from here.
await page.getByRole('button', { name: 'Capture proof of delivery' }).click();
await settle();
await shoot('proof-empty');

await page.getByRole('button', { name: 'Send code to customer' }).click();
await page.waitForTimeout(600);
await page.getByPlaceholder('4 digits').fill('4813');
await settle();
await shoot('proof-code');

// The image picker is a native dialog a screenshot cannot open, so the shot stops one
// step short on purpose: the code is read out, the photo is still missing, and the queue
// button stays disabled until both are present. That disabled state is the thing worth seeing.
await page.getByRole('tab', { name: /^Sync/ }).click();
await settle();
await shoot('sync-pending');

// The Sync button is enabled only while something is waiting, so after a successful sync it
// correctly refuses to press again. The shot is worth taking in both states, but it is not a
// failure if there is nothing left to flush — that is the button doing its job.
const syncButton = page.getByRole('button', { name: /^Sync now/ });
if (await syncButton.isEnabled()) {
  await syncButton.click();
  await page.waitForTimeout(1200);
} else {
  // The queue is already empty. Record it rather than pretending a click happened: a shot labelled
  // "settled" that was taken without syncing is not a settlement shot.
  console.log('skip  sync settle — queue was already empty, nothing to flush');
}
await shoot('sync-settled');

await page.getByRole('tab', { name: 'Profile' }).click();
await settle();
await shoot('profile');

await browser.close();
server.close();
console.log('done — shots/mobile');
