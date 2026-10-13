/**
 * Seeds a verified merchant with a usable API credential — and, with
 * `--profile=demo|load`, the fixture volumes from docs/testing/fixtures.md.
 *
 *   node dist/database/cli.js seed                     # credential only (default)
 *   node dist/database/cli.js seed --profile=demo      # +  20 merchants,  500 shipments
 *   node dist/database/cli.js seed --profile=load      # + 100 merchants, 10000 shipments
 *   node dist/database/cli.js seed --profile=demo --seed=42   # reproducible fixtures
 *
 * The secret is generated and PRINTED once — it is stored only as a hash, so there is no way to
 * recover it afterwards. That is the intended behaviour, not an inconvenience.
 *
 * Profiles APPEND — run one profile once per database: rider phones are unique, so a second
 * identical run fails loudly rather than silently doubling. Fixture shipments are tagged with
 * `merchant_reference = 'fixture-…'` (pricing_version is an integer, so it cannot carry the
 * tag) and each shipment gets its tracking + public-timeline rows here — the fixture must be
 * trackable, or GET /track/:code 404s on the entire load profile (docs/testing/fixtures.md).
 *
 * Customers have no table: a "customer" is the recipient identity carried by a shipment, so the
 * customer count is the size of the identity pool the shipments draw from.
 */
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

const url = process.env.DATABASE_URL ?? 'postgresql://zipzap:zipzap@localhost:5433/zipzap';
const { default: pg } = await import('pg');

const { hashSecret, generateKeyId } = await import('../dist/common/secret.js');

const PROFILES = {
  demo: { merchants: 20, riders: 30, hubs: 5, shipments: 500, customers: 200 },
  load: { merchants: 100, riders: 100, hubs: 20, shipments: 10000, customers: 1000 },
};

const profileArg = process.argv.find((a) => a.startsWith('--profile='))?.slice('--profile='.length);
const profile = profileArg ?? null;
if (profile !== null && !PROFILES[profile]) {
  console.error(`unknown profile "${profile}" — expected demo | load`);
  process.exit(1);
}

const seedArg = process.argv.find((a) => a.startsWith('--seed='))?.slice('--seed='.length);
if (seedArg !== undefined && !/^\d+$/.test(seedArg)) {
  console.error(`--seed must be a non-negative integer, got "${seedArg}"`);
  process.exit(1);
}

// Fixed-seed PRNG (mulberry32): same --seed + same starting DB state → identical
// fixtures, so demos and load runs are reproducible and diffable. Default stays
// time-based so a plain run never collides with a previous one.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = seedArg === undefined ? null : mulberry32(Number(seedArg));
const newId = () => (rng ? uuidFromRng(rng) : randomUUID());
function uuidFromRng(r) {
  const bytes = Array.from({ length: 16 }, () => Math.floor(r() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const newCode = () =>
  rng
    ? `ZP-${Array.from({ length: 10 }, () => Math.floor(rng() * 16).toString(16))
        .join('')
        .toUpperCase()}`
    : `ZP-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await seed();
} finally {
  await client.end();
}

async function seed() {
  const SCOPES = [
    'shipments:read',
    'shipments:write',
    'tracking:read',
    'pickup:create',
    'pickup:read',
    'delivery:create',
    'delivery:read',
    'delivery:complete',
    'settlements:read',
    'settlements:approve',
    'webhooks:manage',
    'returns:read',
    'returns:write',
    'cod:read',
    'keys:manage',
    'hub:read',
    'hub:scan',
  ];

  const runTag = rng ? `s${Number(seedArg).toString(36)}` : Date.now().toString(36);

  // --- credential merchant (always) ----------------------------------------
  const merchantId = randomUUID();
  const keyId = generateKeyId();
  const secret = `sk_${createHash('sha256').update(String(Date.now())).digest('base64url').slice(0, 32)}`;
  const password = `pp_${createHash('sha256')
    .update(String(Date.now()) + 'password')
    .digest('base64url')
    .slice(0, 24)}`;

  const email = `ops+${runTag}@ayesha.test`;
  const userId = randomUUID();

  // One transaction across two schemas: the person, their membership in this merchant, the merchant
  // and the credential are one fact. Splitting them would let a rerun leave a user with no merchant.
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO merchant.merchants (id, name, status, contact_email)
     VALUES ($1, $2, 'ACTIVE', $3)`,
    [merchantId, `Ayesha Fashion Ltd (${runTag})`, email],
  );
  // The credential belongs to the PERSON (migration 0036), not to the merchant — which is what lets
  // one login hold several businesses. MERCHANT_OWNER: this is the merchant's own operator.
  //
  // `display_name` is set because the console renders it in the place a person's name belongs, and
  // `getMe` falls back to the email when it is null. A sidebar reading `ops+k3f9a1@ayesha.test`
  // twice — name line and handle line — is the shape of leaked fixture data, and every screenshot
  // of every surface carries it.
  await client.query(
    `INSERT INTO identity.users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)`,
    [userId, email, hashSecret(password), 'Ayesha Rahman'],
  );
  await client.query(
    `INSERT INTO identity.user_merchants (user_id, merchant_id, role)
     VALUES ($1, $2, 'MERCHANT_OWNER')`,
    [userId, merchantId],
  );
  await client.query(
    `INSERT INTO merchant.api_credentials (id, merchant_id, key_id, secret_hash, scopes)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), merchantId, keyId, hashSecret(secret), SCOPES],
  );
  await client.query('COMMIT');

  if (profile) await seedProfile(PROFILES[profile], profile, runTag, merchantId);

  // The hub console's operator. Same merchant — because that is how a membership is expressed —
  // but a role whose ONLY write scope is `hub:scan`, so this login can move parcels between hubs
  // and cannot create, cancel or settle anything.
  const hubEmail = `hub+${runTag}@ayesha.test`;
  const hubUserId = randomUUID();
  const hubPassword = `hh_${createHash('sha256')
    .update(String(Date.now()) + 'hubpassword')
    .digest('base64url')
    .slice(0, 24)}`;
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO identity.users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)`,
    [hubUserId, hubEmail, hashSecret(hubPassword), 'Rafiqul Islam'],
  );
  await client.query(
    `INSERT INTO identity.user_merchants (user_id, merchant_id, role)
     VALUES ($1, $2, 'HUB_OPERATOR')`,
    [hubUserId, merchantId],
  );
  // Assign the operator to the first hub so the console lands directly on it instead of a picker.
  // Hubs are seeded by `seedProfile` above, so one exists here. The first hub by code is an
  // arbitrary but stable choice — the point is that the demo login has somewhere to land.
  const { rows: firstHub } = await client.query(`SELECT id FROM hub.hubs ORDER BY code LIMIT 1`);
  if (firstHub[0]) {
    await client.query(
      `INSERT INTO hub.staff (user_id, hub_id, role, assigned_by)
       VALUES ($1, $2, 'OPERATOR', $1)`,
      [hubUserId, firstHub[0].id],
    );
  }
  await client.query('COMMIT');

  // The operations account. There was none, which quietly made two thirds of the product
  // unreachable to anyone seeding a dev environment: the control tower needs `network:read`,
  // an OPERATIONS_MANAGER scope, and MERCHANT_OWNER deliberately does not hold it (see
  // `MERCHANT_GRANTABLE_ROLES` — a merchant may only grant roles over their own tenancy).
  //
  // So every reviewer and every shots run either skipped the control tower or logged in as the
  // merchant and captured a PERMISSION_DENIED error box, which looks like a broken product.
  // A seed that cannot produce an account for a surface it ships is an incomplete seed.
  const opsEmail = `network+${runTag}@ayesha.test`;
  const opsUserId = randomUUID();
  const opsPassword = `op_${createHash('sha256')
    .update(String(Date.now()) + 'opspassword')
    .digest('base64url')
    .slice(0, 24)}`;
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO identity.users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)`,
    [opsUserId, opsEmail, hashSecret(opsPassword), 'Tanvir Hossain'],
  );
  await client.query(
    `INSERT INTO identity.user_merchants (user_id, merchant_id, role)
     VALUES ($1, $2, 'OPERATIONS_MANAGER')`,
    [opsUserId, merchantId],
  );
  await client.query('COMMIT');

  // A rider who can actually sign in, with a phone number as the handle.
  //
  // Every fixture rider above is a row in `rider.riders` with no credential, which meant NONE of
  // them could authenticate — the rider app's login screen works against the API, but there was
  // no seeded account to exercise it with, and the phone-number flow it now asks for had no rider
  // to log in. So the one screen the person on the bike uses daily was the one screen a reviewer
  // could not get into.
  //
  // A rider therefore has two rows, which is the model the rest of the system already uses and
  // which this does not invent: `rider.riders` holds the operational record (capacity, position,
  // status) and `identity.users` holds the credential. See ADR-0002 and `rules/phone.ts`.
  // The rider's number uses the same derivation `seedProfile` uses for the fixture riders, so a
  // rider who can log in collides with no fixture. It is computed here rather than read from
  // `seedProfile`, because that function owns its own number range and borrowing one of its values
  // would couple a login to whether a profile ran at all.
  const riderPhoneBase = 80_000_000 + (parseInt(runTag, 36) % 10_000_000);
  const riderPhone = `+88017${String(riderPhoneBase)}`;
  const riderUserId = randomUUID();
  const riderPassword = `rd_${createHash('sha256')
    .update(String(Date.now()) + 'riderpassword')
    .digest('base64url')
    .slice(0, 24)}`;
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO identity.users (id, email, phone, password_hash, display_name)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      riderUserId,
      // An email is NOT NULL on identity.users, and it is not the handle — the phone is. This is a
      // synthesised, non-routable address so the column stays honest about being a column nobody
      // types. It is never used to sign in and never shown to the rider.
      `rider+${runTag}@riders.zipzap.local`,
      riderPhone,
      hashSecret(riderPassword),
      'Shahriar Alam',
    ],
  );
  // A membership, because a session is anchored to a business — `merchant.sessions.merchant_id`
  // is NOT NULL and `authenticateToken` JOINs `merchant.merchants`. Without a row the rider
  // passes the password and is then refused with `no_membership`, which is the correct failure
  // name and the wrong failure for a rider: they are not supposed to be a *member* of anything,
  // they are supposed to be dispatched to parcels.
  //
  // So the RIDER role attaches to the seeded merchant, and its scope bundle is exactly the five
  // scopes the rider app needs (`rules/roles.ts`) — no shipments:write, no settlements:approve,
  // nothing that gates another merchant's data. A rider's tenancy is then correct by
  // construction: they can only act on riders, and the rider module scopes the rest.
  await client.query(
    `INSERT INTO identity.user_merchants (user_id, merchant_id, role)
     VALUES ($1, $2, 'RIDER')`,
    [riderUserId, merchantId],
  );
  // No membership: a rider is not a member of a merchant's business, and a rider must not be
  // scoped to one merchant's shipments. The rider's scope comes from the rider module's own
  // records, exactly as it did before this column existed.
  await client.query('COMMIT');

  console.log(`merchant_id : ${merchantId}`);
  console.log(`key_id      : ${keyId}`);
  console.log(`secret      : ${secret}`);
  console.log(`email       : ${email}`);
  console.log(`password    : ${password}`);
  console.log();
  console.log('Hub console login (scans parcels, reconciles manifests, no merchant power):');
  console.log(`hub_email   : ${hubEmail}`);
  console.log(`hub_password: ${hubPassword}`);
  console.log();
  console.log('Operations console login (network:read — the control tower):');
  console.log(`ops_email   : ${opsEmail}`);
  console.log(`ops_password: ${opsPassword}`);
  console.log();
  console.log('   (named network+ rather than ops+ because the merchant owner above is already');
  console.log('    ops+<tag> — they are different principals with deliberately different scopes)');
  console.log();
  console.log();
  console.log('Rider app login — PHONE NUMBER, not an email:');
  console.log(`rider_phone: ${riderPhone}`);
  console.log(`rider_password: ${riderPassword}`);
  console.log('   (the email above is a placeholder the column requires, never the handle)');
  console.log();
  console.log('Authorization: ApiKey <key_id>.<secret>');
  console.log('Login:       POST /v1/auth/login { email, password }');

  // The same values again, in a form a script can consume.
  //
  // Passwords are hashed, so they are unrecoverable after this line — which made every shots run
  // depend on someone copying four values out of a terminal by hand. Getting one wrong produced a
  // login screen with no explanation, and the natural reading was "the seed is broken" rather than
  // "the password was transcribed incorrectly". Printing a sourceable block means
  // `eval "$(pnpm db:seed | sed -n '/^export /p')"` sets the environment correctly, and a
  // transcription error stops being possible.
  //
  // Dev-only by construction: this only runs against a database you just seeded, and these
  // accounts exist only there. `.env` is gitignored; nothing here is ever committed.
  console.log();
  console.log('# eval this to get every seeded login into the environment:');
  console.log(`#   eval "$(pnpm db:seed | sed -n '/^export /p')"`);
  console.log(`export SEED_CONSOLE_EMAIL=${email}`);
  console.log(`export SEED_CONSOLE_PASSWORD=${password}`);
  console.log(`export SEED_HUB_EMAIL=${hubEmail}`);
  console.log(`export SEED_HUB_PASSWORD=${hubPassword}`);
  console.log(`export SEED_OPS_EMAIL=${opsEmail}`);
  console.log(`export SEED_OPS_PASSWORD=${opsPassword}`);
  console.log(`export SEED_API_KEY_ID=${keyId}`);
  console.log(`export SEED_API_SECRET=${secret}`);
  console.log(`export SEED_RIDER_EMAIL=rider+${runTag}@riders.zipzap.local`);
  console.log(`export SEED_RIDER_PASSWORD=${riderPassword}`);
  console.log(`export SEED_RIDER_PHONE=${riderPhone}`);
}

async function seedProfile(counts, name, runTag, credentialMerchantId) {
  // Shadow the crypto import: every fixture id/code below flows from the PRNG
  // when --seed is given, and from crypto.randomUUID otherwise.
  const randomUUID = newId;
  const merchantIds = [credentialMerchantId];

  // Merchants (the credential merchant is profile merchant #1).
  await client.query('BEGIN');
  for (let i = 1; i < counts.merchants; i++) {
    const id = randomUUID();
    merchantIds.push(id);
    await client.query(
      `INSERT INTO merchant.merchants (id, name, status, contact_email)
       VALUES ($1, $2, 'ACTIVE', $3)`,
      [id, `Fixture Merchant ${i} (${runTag})`, `merchant${i}+${runTag}@fixture.test`],
    );
  }
  await client.query('COMMIT');

  // Riders — synthetic, append per run. Phones are UNIQUE; the base is derived
  // from the run tag so two profiles never share a phone range (90M+ was the
  // collision when every run started at the same number).
  const phoneBase = 80_000_000 + (parseInt(runTag, 36) % 10_000_000);
  await client.query('BEGIN');
  for (let i = 0; i < counts.riders; i++) {
    await client.query(
      `INSERT INTO rider.riders (id, display_name, phone, status, capacity)
       VALUES ($1, $2, $3, 'OFFLINE', $4)`,
      [randomUUID(), `Fixture Rider ${i}`, `+88017${String(phoneBase + i)}`, 2 + (i % 3)],
    );
  }
  await client.query('COMMIT');

  // Hubs — top up to the profile's hub count; the seeded network may already
  // exceed a small profile (demo wants 5, migration 0025 ships 6).
  const zones = [
    { zone: 'dhaka-metro', lng: 90.41, lat: 23.81 },
    { zone: 'chattogram-metro', lng: 91.83, lat: 22.35 },
    { zone: 'khulna-metro', lng: 89.56, lat: 22.8 },
    { zone: 'rajshahi-metro', lng: 88.6, lat: 24.37 },
    { zone: 'barishal-metro', lng: 90.37, lat: 22.7 },
    { zone: 'rangpur-metro', lng: 89.25, lat: 25.74 },
    { zone: 'sylhet-metro', lng: 91.87, lat: 24.89 },
    { zone: 'mymensingh-metro', lng: 90.4, lat: 24.75 },
  ];
  const { rows: hubRows } = await client.query(`SELECT count(*)::int AS n FROM hub.hubs`);
  const hubShortfall = Math.max(0, counts.hubs - hubRows[0].n);
  if (hubShortfall > 0) {
    await client.query('BEGIN');
    for (let i = 0; i < hubShortfall; i++) {
      const place = zones[i % zones.length];
      const seq = Math.floor(i / zones.length) + 1;
      const prefix = place.zone.split('-')[0].slice(0, 3).toUpperCase();
      await client.query(
        `INSERT INTO hub.hubs (id, code, name, kind, location, network_zone)
         VALUES ($1, $2, $3, $4,
                 ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7)`,
        [
          randomUUID(),
          `FX-${prefix}-${seq}`,
          `Fixture Hub ${prefix}-${seq}`,
          seq % 2 === 1 ? 'DISTRICT_HUB' : 'REGIONAL_HUB',
          place.lng + (i % 3) * 0.01,
          place.lat + ((i + 1) % 3) * 0.01,
          place.zone,
        ],
      );
    }
    await client.query('COMMIT');
  }

  // Customer pool — recipient identities the shipments draw from.
  const customers = Array.from({ length: counts.customers }, (_, i) => ({
    name: `Customer ${i}`,
    phone: `+8801${3 + (i % 7)}${String(10_000_000 + i)}`,
    address: `${i + 1} Fixture Road, Dhaka`,
  }));

  // Shipments + their tracking + public-timeline rows, in batches.
  const now = Date.now();
  const batchSize = 500;
  let inserted = 0;
  for (let start = 0; start < counts.shipments; start += batchSize) {
    const size = Math.min(batchSize, counts.shipments - start);
    await client.query('BEGIN');
    for (let j = 0; j < size; j++) {
      const i = start + j;
      const id = randomUUID();
      const code = newCode();
      const recipient = customers[i % customers.length];
      const merchant = merchantIds[i % merchantIds.length];
      const createdAt = new Date(now - (i % 14) * 86_400_000 - (i % 24) * 3_600_000);
      const cod = i % 10 < 6 ? 5_000 + (i % 50) * 5_000 : 0;
      await client.query(
        `INSERT INTO shipment.shipments
           (id, tracking_code, merchant_id, merchant_reference, sender_name, sender_phone,
            sender_address, recipient_name, recipient_phone, recipient_address,
            parcel_weight_grams, parcel_description, cod_amount_minor, cod_currency,
            status, pricing_version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Fixture Sender', '+8801712345678', 'Warehouse 1, Dhaka',
                 $5, $6, $7, $8, 'fixture parcel', $9, 'BDT', 'CREATED', 1, $10, $10)`,
        [
          id,
          code,
          merchant,
          `fixture-${name}-${runTag}-${i}`,
          recipient.name,
          recipient.phone,
          recipient.address,
          100 + (i % 50) * 100,
          cod,
          createdAt,
        ],
      );
      // The authoritative log and the public projection the track endpoint reads —
      // a fixture without timeline rows is invisible to GET /track/:code.
      await client.query(
        `INSERT INTO tracking.events
           (id, shipment_id, event_type, occurred_at, actor_type)
         VALUES ($1, $2, 'SHIPMENT_CREATED', $3, 'MERCHANT')`,
        [randomUUID(), id, createdAt],
      );
      await client.query(
        `INSERT INTO tracking.public_timeline
           (id, tracking_code, shipment_id, sequence, event_type, occurred_at)
         VALUES ($1, $2, $3, 1, 'SHIPMENT_CREATED', $4)`,
        [randomUUID(), code, id, createdAt],
      );
      // The COD promise, exactly what EnsureCodRecord would create — without it
      // every simulated delivery with a COD amount dies on CodRecordNotFoundError.
      if (cod > 0) {
        await client.query(
          `INSERT INTO cod.records (id, shipment_id, merchant_id, expected_minor, currency, status)
           VALUES ($1, $2, $3, $4, 'BDT', 'COD_EXPECTED')`,
          [randomUUID(), id, merchant, cod],
        );
      }
      inserted += 1;
    }
    await client.query('COMMIT');
  }

  const { rows: fixture } = await client.query(
    `SELECT count(*)::int AS n FROM shipment.shipments WHERE merchant_reference LIKE 'fixture-%'`,
  );
  console.log();
  console.log(`profile     : ${name}`);
  console.log(
    `merchants   : ${counts.merchants} this run (${credentialMerchantId} carries the credential)`,
  );
  console.log(`riders      : ${counts.riders}`);
  console.log(`hubs        : ${hubRows[0].n} now (${hubShortfall} added)`);
  console.log(`customers   : ${counts.customers} recipient identities`);
  console.log(`shipments   : ${inserted} this run (${fixture[0].n} fixtures total)`);
}
