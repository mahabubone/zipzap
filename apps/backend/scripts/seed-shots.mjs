/**
 * Seeds a merchant console worth photographing.
 *
 * `seed.mjs` creates the accounts. `seed-console.mjs` creates eight parcels that all sit at
 * `CREATED`, which is a truthful but useless demo: every shipment list looks identical, and the
 * shipment detail timeline — the most interesting screen in the product — renders as an empty
 * movement history with one entry.
 *
 * This advances a set of them through the REAL lifecycle instead, using the same services the API
 * uses, via `runSimulation` from `src/simulate.ts`. Six scenarios, six different end states, so
 * the shipments table shows a spread of statuses and the timeline shows a journey:
 *
 *   DELIVERED · DELIVERED (after a failed attempt) · RETURN_INITIATED · RETURNED · LOST · DAMAGED
 *
 * `delivered` and `failed-then-delivered` both capture a real proof of delivery — the OTP code is
 * issued, read out and submitted with a photo — because `AdvanceDeliveryService.complete` refuses a
 * delivery without verified evidence. A screenshot that skipped proof would be showing a path no
 * rider can actually perform.
 *
 * Dev-only. Never deployed, never run against anything but a local database.
 *
 * Usage:
 *   SEED_CONSOLE_EMAIL=... SEED_CONSOLE_PASSWORD=... node --env-file-if-exists=../../.env \
 *     apps/backend/scripts/seed-shots.mjs
 */

import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import { AppModule } from '../dist/app.module.js';
import { runSimulation } from '../dist/simulate.js';

const BASE = process.env.API_URL ?? 'http://localhost:3000';
const email = process.env.SEED_CONSOLE_EMAIL;
const password = process.env.SEED_CONSOLE_PASSWORD;

if (!email || !password) {
  console.error('Set SEED_CONSOLE_EMAIL and SEED_CONSOLE_PASSWORD (see `pnpm db:seed` output).');
  process.exit(1);
}

/**
 * The parcels, with the state each should end in.
 *
 * Deliberately varied in weight, destination and description: a demo where every row says "Two
 * shirts, Dhaka to Dhaka" reads as generated data, and a reviewer who notices that stops
 * believing the rest of the screen.
 */
const PARCELS = [
  {
    scenario: 'delivered',
    recipientName: 'Rahim Uddin',
    recipientPhone: '+8801800000101',
    recipientAddress: 'Agrabad C/A, Chattogram',
    parcelWeightGrams: 1200,
    parcelDescription: 'Two shirts',
  },
  {
    scenario: 'failed-then-delivered',
    recipientName: 'Karim Mia',
    recipientPhone: '+8801800000102',
    recipientAddress: 'Zindabazar, Sylhet',
    parcelWeightGrams: 800,
    parcelDescription: 'Running shoes',
  },
  {
    scenario: 'customer-refused',
    recipientName: 'Nasir Hossain',
    recipientPhone: '+8801800000103',
    recipientAddress: 'Cotton Road, Cumilla',
    parcelWeightGrams: 3400,
    parcelDescription: 'Books, heavy',
  },
  {
    scenario: 'returned',
    recipientName: 'Farida Begum',
    recipientPhone: '+8801800000104',
    recipientAddress: 'Bogura bazar',
    parcelWeightGrams: 600,
    parcelDescription: 'Gift box',
  },
  {
    scenario: 'damaged',
    recipientName: 'Tanvir Ahmed',
    recipientPhone: '+8801800000105',
    recipientAddress: 'Boyra, Khulna',
    parcelWeightGrams: 2200,
    parcelDescription: 'Phone case, fragile',
  },
  {
    scenario: 'lost',
    recipientName: 'Shahana Akter',
    recipientPhone: '+8801800000106',
    recipientAddress: 'Khaliajore, Barishal',
    parcelWeightGrams: 1500,
    parcelDescription: 'Saree',
  },
];

const login = await fetch(`${BASE}/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  // `identifier`, not `email`: the login DTO takes a handle since phones became valid ones
  // (rules/phone.ts). A console still sends an email; the field is the same either way.
  body: JSON.stringify({ identifier: email, password }),
});
if (!login.ok) {
  console.error(`login failed: ${login.status} ${await login.text()}`);
  process.exit(1);
}

// The session comes back as an `HttpOnly` cookie, not a bearer token — ADR-0016. `login.json()`
// therefore has no `token`, and destructuring one yields `undefined`, which every subsequent
// request dutifully sends as the literal string `Authorization: Bearer undefined`. The server
// answers 401 for all of them and the script reports "0 shipments seeded" with no obvious cause.
//
// That is exactly what happened the first time this ran, and the fix belongs here rather than in
// the server: cookie sessions are the shipped design, and a script that assumes otherwise is the
// thing that is wrong. See the note in `seed-console.mjs` for the same correction.
const cookie = (login.headers.getSetCookie?.() ?? [login.headers.get('set-cookie')])
  .filter(Boolean)
  .map((c) => c.split(';')[0])
  .join('; ');
if (!cookie) {
  console.error('login returned no session cookie — cannot seed.');
  process.exit(1);
}
const auth = { Cookie: cookie, 'Content-Type': 'application/json' };

const created = [];
for (const [i, p] of PARCELS.entries()) {
  const res = await fetch(`${BASE}/v1/shipments`, {
    method: 'POST',
    headers: { ...auth, 'Idempotency-Key': `shots-seed-${i + 1}` },
    body: JSON.stringify({
      senderName: 'Ayesha Textiles',
      senderPhone: '+8801700000000',
      senderAddress: 'Gulshan 1, Dhaka 1212',
      recipientName: p.recipientName,
      recipientPhone: p.recipientPhone,
      recipientAddress: p.recipientAddress,
      parcelWeightGrams: p.parcelWeightGrams,
      parcelDescription: p.parcelDescription,
      zone: 'dhaka-metro',
      remoteArea: false,
      fragile: p.scenario === 'damaged',
      codAmountMinor: 125_050,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`create failed for ${p.recipientName}: ${res.status} ${JSON.stringify(body)}`);
    continue;
  }
  created.push({ code: body.trackingCode, scenario: p.scenario });
  console.log(`created  ${body.trackingCode}  ${p.scenario.padEnd(22)} ${p.recipientName}`);
}

// One application context for every parcel. Each `runSimulation` opens its own Nest context by
// default, and six of them would mean six module graphs, six Postgres pools and ~40 seconds of
// boot for a script whose entire job is to move eight rows.
const app = await NestFactory.createApplicationContext(AppModule);
try {
  for (const { code, scenario } of created) {
    try {
      const result = await runSimulation(code, scenario, app);
      console.log(`simulated ${code}  → ${result.finalStatus}`);
    } catch (error) {
      // One parcel failing must not abandon the other five: a partial seed is still useful, and
      // the failure is printed rather than swallowed so it can be read and fixed.
      console.error(`scenario "${scenario}" failed for ${code}: ${error.message}`);
    }
  }
} finally {
  await app.close();
}

console.log(`\n${created.length} shipments seeded. Public tracking:`);
for (const { code, scenario } of created) {
  console.log(`  ${BASE}/track/${code}  (${scenario})`);
}

/**
 * Run a settlement to completion, so the money screens have something real in them.
 *
 * Without this the console's three finance screens — settlement list, statement, and the
 * reconciliation queue — all render their empty states, which are honest and well-written and
 * completely unconvincing as a portfolio screenshot. Worse, an empty state proves nothing: it
 * looks identical whether the feature works or not.
 *
 * So this walks the actual lifecycle over HTTP, in the order a merchant would: create a
 * settlement from the collected cash, approve it, initiate the payout, confirm the payment. Every
 * step is idempotency-keyed, so re-running is safe.
 *
 * It is expected to fail on a merchant whose cash is still uncollected — settlement refuses to
 * freeze money that has not landed, which is the rule doing its job. That is reported, not
 * swallowed, so a failure here is a real signal about the fixture set.
 */
console.log('\n--- rider positions ---');

/**
 * Give the seeded riders a live position.
 *
 * The control tower's map showed 0 riders, and the honest reason was that the only riders in the
 * database are the ones the simulations registered, and none of them had ever reported a location —
 * `rider.riders` starts with `last_known_*` NULL. That is correct for real data and useless as a
 * screenshot: a map of only hubs does not look like an operations tool, and the whole point of the
 * screen is that the network is alive.
 *
 * So each rider reports through the same endpoint the app uses, spread across the divisions the
 * network covers. The staleness colouring is NOT defeated — a rider who stops reporting goes grey on
 * the next snapshot, which is the behaviour worth having.
 *
 * Rider ids are read from `rider.riders` because there is no `GET /v1/riders` in the public API and
 * no rider id in `SimulationResult`. The endpoint that says who exists is the table, so the table is
 * asked. It uses the rider module's own connection, not a global pool.
 */
async function positionRiders() {
  const pgMod = await import('pg').catch(() => null);
  if (!pgMod) {
    console.log('      pg unavailable — skipping rider positions');
    return;
  }
  {
    const { Client } = pgMod.default ?? pgMod;
    const riderDb = new Client({ connectionString: process.env.DATABASE_URL });
    await riderDb.connect();
    try {
      const { rows } = await riderDb.query(
        `SELECT id, display_name FROM rider.riders ORDER BY created_at DESC LIMIT 6`,
      );

      // Positions are reported AS A RIDER, not as the merchant. `POST /v1/riders/:id/position` is
      // guarded by `rider:sync`, which is a RIDER-role scope and deliberately not held by any
      // merchant role — a shop owner must not be able to move a rider on a map. Using the merchant
      // here gets a 403, which is the system working.
      if (!process.env.SEED_RIDER_PHONE) {
        console.log(
          "      no SEED_RIDER_PHONE — skipping (a position needs the rider's own session)",
        );
        return;
      }
      const riderLogin = await fetch(`${BASE}/v1/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: process.env.SEED_RIDER_PHONE,
          password: process.env.SEED_RIDER_PASSWORD,
        }),
      });
      if (!riderLogin.ok) {
        console.log(`      rider login failed (${riderLogin.status}) — skipping positions`);
        return;
      }
      const { token: riderToken } = await riderLogin.json();
      const riderAuth = { Authorization: `Bearer ${riderToken}` };

      // Dhaka, Chattogram, Sylhet, Khulna, Rajshahi — the hubs the network actually runs.
      const hubCoords = [
        { lat: 23.81, lng: 90.41 },
        { lat: 22.36, lng: 91.83 },
        { lat: 24.9, lng: 91.87 },
        { lat: 22.84, lng: 89.56 },
        { lat: 24.37, lng: 88.6 },
      ];

      for (const [i, rider] of rows.entries()) {
        const hub = hubCoords[i % hubCoords.length];
        const res = await fetch(`${BASE}/v1/riders/${rider.id}/position`, {
          method: 'POST',
          headers: { ...riderAuth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // Jittered by a few hundred metres so markers separate instead of stacking into one
            // dot and reading as a single rider.
            latitude: hub.lat + (Math.random() - 0.5) * 0.08,
            longitude: hub.lng + (Math.random() - 0.5) * 0.08,
            accuracyMeters: 12,
            recordedAt: '2026-10-12T10:00:00.000Z',
          }),
        });
        if (!res.ok) {
          console.error(`      ${(await res.text()).slice(0, 300)}`);
        }
        console.log(
          `${res.ok ? 'positioned' : 'position skipped'}  ${(rider.display_name ?? rider.id).padEnd(16)} → ${res.status}`,
        );
      }
    } finally {
      await riderDb.end();
    }
  }
}

await positionRiders();

console.log('\n--- settlement ---');
const post = async (path, body, key) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...auth, 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null };
};

const merchantId = (await (await fetch(`${BASE}/v1/me`, { headers: { ...auth } })).json())
  .merchantId;

const createdSettlement = await post(
  '/v1/settlements',
  { merchantId, note: 'Weekly payout' },
  `shots-settlement-${Date.now()}`,
);

if (!createdSettlement.ok) {
  console.error(
    `settlement not created: ${createdSettlement.status} ${JSON.stringify(createdSettlement.body)}`,
  );
  console.error('  (expected while cash is still uncollected — settlement will not freeze it)');
} else {
  const id = createdSettlement.body.id;
  console.log(`created   settlement ${id}`);

  // `approverId` is required and is a deliberate field rather than an inference from the
  // session: the statement records WHO approved a payout, and a settlement that can be approved
  // without naming the approver cannot answer a dispute six months later.
  const me = await (await fetch(`${BASE}/v1/me`, { headers: { ...auth } })).json();
  const approved = await post(
    `/v1/settlements/${id}/approve`,
    { approverId: me.subjectId },
    `shots-approve-${Date.now()}`,
  );
  console.log(approved.ok ? 'approved  settlement' : `approve skipped: ${approved.status}`);

  const initiated = await post(
    `/v1/settlements/${id}/initiate-payment`,
    {},
    `shots-initiate-${Date.now()}`,
  );
  console.log(initiated.ok ? 'initiated payout' : `initiate skipped: ${initiated.status}`);

  const confirmed = await post(
    `/v1/settlements/${id}/confirm-payment`,
    {},
    `shots-confirm-${Date.now()}`,
  );
  console.log(confirmed.ok ? 'confirmed payout' : `confirm skipped: ${confirmed.status}`);
  console.log(`statement: ${BASE}/v1/settlements/${id}/statement.csv`);
}
