/**
 * Local console seeding — creates a handful of shipments through the public API
 * so the merchant console has something to render. Not a test fixture and not
 * deployed; this is the "make the dev environment usable" script.
 *
 * Usage: node --env-file-if-exists=../../.env scripts/seed-console.mjs
 * Reads SEED_CONSOLE_EMAIL / SEED_CONSOLE_PASSWORD from the environment when
 * present, otherwise prompts are avoided by failing loudly with the seed output
 * you need to paste from `pnpm db:seed`.
 */

const BASE = process.env.API_URL ?? 'http://localhost:3000';
const email = process.env.SEED_CONSOLE_EMAIL;
const password = process.env.SEED_CONSOLE_PASSWORD;

if (!email || !password) {
  console.error('Set SEED_CONSOLE_EMAIL and SEED_CONSOLE_PASSWORD (see `pnpm db:seed` output).');
  process.exit(1);
}

const PARCELS = [
  {
    name: 'Rahim Uddin',
    phone: '+8801800000001',
    address: 'Agrabad C/A, Chattogram',
    grams: 1200,
    desc: 'Two shirts',
    zone: 'dhaka-metro',
  },
  {
    name: 'Karim Mia',
    phone: '+8801800000002',
    address: 'Zindabazar, Sylhet',
    grams: 800,
    desc: 'Running shoes',
    zone: 'dhaka-metro',
  },
  {
    name: 'Nasir Hossain',
    phone: '+8801800000003',
    address: 'Cotton Road, Cumilla',
    grams: 3400,
    desc: 'Books, heavy',
    zone: 'dhaka-metro',
  },
  {
    name: 'Farida Begum',
    phone: '+8801800000004',
    address: 'Bogura bazar',
    grams: 600,
    desc: 'Gift box',
    zone: 'dhaka-metro',
  },
  {
    name: 'Tanvir Ahmed',
    phone: '+8801800000005',
    address: 'Boyra, Khulna',
    grams: 2200,
    desc: 'Phone case',
    zone: 'dhaka-metro',
  },
  {
    name: 'Shahana Akter',
    phone: '+8801800000006',
    address: 'Khaliajore, Barishal',
    grams: 1500,
    desc: 'Saree',
    zone: 'dhaka-metro',
  },
  {
    name: 'Jahangir Alam',
    phone: '+8801800000007',
    address: 'Rangpur city',
    grams: 2900,
    desc: 'Rice bag, 5kg',
    zone: 'dhaka-metro',
  },
  {
    name: 'Rehana Parvin',
    phone: '+8801800000008',
    address: 'Feni bazar',
    grams: 400,
    desc: 'Perfume',
    zone: 'dhaka-metro',
  },
];

const login = await fetch(`${BASE}/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) {
  console.error(`login failed: ${login.status} ${await login.text()}`);
  process.exit(1);
}
const { token } = await login.json();
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const created = [];
for (const [i, p] of PARCELS.entries()) {
  const res = await fetch(`${BASE}/v1/shipments`, {
    method: 'POST',
    headers: { ...auth, 'Idempotency-Key': `console-seed-${i + 1}` },
    body: JSON.stringify({
      senderName: 'Ayesha Textiles',
      senderPhone: '+8801700000000',
      senderAddress: 'Gulshan 1, Dhaka 1212',
      recipientName: p.name,
      recipientPhone: p.phone,
      recipientAddress: p.address,
      parcelWeightGrams: p.grams,
      parcelDescription: p.desc,
      zone: p.zone,
      remoteArea: false,
      fragile: false,
    }),
  });
  const body = await res.json();
  if (res.ok) {
    created.push(body.trackingCode);
    console.log(`${body.trackingCode}  ${p.name.padEnd(18)} ${p.desc}`);
  } else {
    console.error(`failed for ${p.name}: ${res.status} ${JSON.stringify(body)}`);
  }
}

console.log(`\n${created.length}/${PARCELS.length} shipments created.`);
console.log(`Track one publicly: curl ${BASE}/track/${created[0] ?? 'CODE'}`);
