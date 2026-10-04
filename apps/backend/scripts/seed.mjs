/**
 * Seeds a verified merchant with a usable API credential.
 *
 * The secret is generated and PRINTED once — it is stored only as a hash, so there is no way to
 * recover it afterwards. That is the intended behaviour, not an inconvenience.
 */
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

const url = process.env.DATABASE_URL ?? 'postgresql://zipzap:zipzap@localhost:5433/zipzap';
const { default: pg } = await import('pg');

const { hashSecret, generateKeyId } = await import('../dist/common/secret.js');

const client = new pg.Client({ connectionString: url });
await client.connect();

const merchantId = randomUUID();
const keyId = generateKeyId();
const secret = `sk_${createHash('sha256').update(String(Date.now())).digest('base64url').slice(0, 32)}`;

const runTag = Date.now().toString(36);
const merchantName = `Ayesha Fashion Ltd (${runTag})`;
const contactEmail = `ops+${runTag}@ayesha.test`;

await client.query('BEGIN');
await client.query(
  `INSERT INTO merchant.merchants (id, name, status, contact_email)
   VALUES ($1, $2, 'ACTIVE', $3)`,
  [merchantId, merchantName, contactEmail],
);
await client.query(
  `INSERT INTO merchant.api_credentials (id, merchant_id, key_id, secret_hash, scopes)
   VALUES ($1, $2, $3, $4, $5)`,
  [randomUUID(), merchantId, keyId, hashSecret(secret), ['shipments:read', 'shipments:write', 'tracking:read', 'pickup:create', 'pickup:read', 'delivery:create', 'delivery:read', 'delivery:complete', 'settlements:read', 'settlements:approve', 'webhooks:manage']],
);
await client.query('COMMIT');

console.log(`merchant_id : ${merchantId}`);
console.log(`key_id      : ${keyId}`);
console.log(`secret      : ${secret}`);
console.log();
console.log('Authorization: ApiKey <key_id>.<secret>');
await client.end();
