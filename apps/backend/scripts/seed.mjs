/**
 * Seeds a verified merchant with a usable API credential — and, with
 * `--profile=demo|load`, the fixture volumes from docs/testing/fixtures.md.
 *
 *   node dist/database/cli.js seed                     # credential only (default)
 *   node dist/database/cli.js seed --profile=demo      # +  20 merchants,  500 shipments
 *   node dist/database/cli.js seed --profile=load      # + 100 merchants, 10000 shipments
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
  ];

  const runTag = Date.now().toString(36);

  // --- credential merchant (always) ----------------------------------------
  const merchantId = randomUUID();
  const keyId = generateKeyId();
  const secret = `sk_${createHash('sha256').update(String(Date.now())).digest('base64url').slice(0, 32)}`;

  await client.query('BEGIN');
  await client.query(
    `INSERT INTO merchant.merchants (id, name, status, contact_email)
     VALUES ($1, $2, 'ACTIVE', $3)`,
    [merchantId, `Ayesha Fashion Ltd (${runTag})`, `ops+${runTag}@ayesha.test`],
  );
  await client.query(
    `INSERT INTO merchant.api_credentials (id, merchant_id, key_id, secret_hash, scopes)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), merchantId, keyId, hashSecret(secret), SCOPES],
  );
  await client.query('COMMIT');

  if (profile) await seedProfile(PROFILES[profile], profile, runTag, merchantId);

  console.log(`merchant_id : ${merchantId}`);
  console.log(`key_id      : ${keyId}`);
  console.log(`secret      : ${secret}`);
  console.log();
  console.log('Authorization: ApiKey <key_id>.<secret>');
}

async function seedProfile(counts, name, runTag, credentialMerchantId) {
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
      const code = `ZP-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
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
  console.log(`merchants   : ${counts.merchants} this run (${credentialMerchantId} carries the credential)`);
  console.log(`riders      : ${counts.riders}`);
  console.log(`hubs        : ${hubRows[0].n} now (${hubShortfall} added)`);
  console.log(`customers   : ${counts.customers} recipient identities`);
  console.log(`shipments   : ${inserted} this run (${fixture[0].n} fixtures total)`);
}
