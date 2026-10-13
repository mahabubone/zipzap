/**
 * Proof-of-delivery: the constraints that make a proof mean something, proved against the real
 * database rather than against a description of it.
 *
 * Every claim this file makes is enforced in Postgres, not in TypeScript, so the only honest test
 * is to ask Postgres. Run after `pnpm db:migrate`.
 *
 *   node scripts/verify-delivery-proofs.mjs
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://zipzap:zipzap@localhost:5433/zipzap',
});

let passed = 0;
let failed = 0;

function check(what, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${what}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${what}\n      ${error.message}`);
  }
}

/**
 * Runs `fn` and returns the SQLSTATE, or null when the statement unexpectedly succeeded.
 *
 * Each call gets its own savepoint. Without one the first violated constraint aborts the enclosing
 * transaction and every statement after it fails with 25P02 (no_data_found) instead of its own
 * error — the file would then "prove" the wrong thing for twenty checks in a row.
 */
async function sqlstate(fn) {
  await client.query('SAVEPOINT probe');
  try {
    await fn();
    await client.query('RELEASE SAVEPOINT probe');
    return null;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT probe');
    return error.code ?? error.message;
  }
}

const insert = (client, row) =>
  client.query(
    `INSERT INTO delivery.delivery_proofs
       (id, job_id, code_hash, code_salt, code_issued_at, code_expires_at, attempts_used, status,
        otp_verified_at, photo_sha256, photo_content_type, photo_byte_length, photo_data,
        latitude, longitude)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      row.id ?? randomUUID(),
      row.jobId ?? randomUUID(),
      row.codeHash ?? 'h1',
      row.codeSalt ?? 's1',
      row.issuedAt ?? new Date(),
      row.expiresAt ?? new Date(Date.now() + 600_000),
      row.attemptsUsed ?? 0,
      row.status ?? 'PENDING',
      row.otpVerifiedAt ?? null,
      row.photoSha256 ?? null,
      row.photoContentType ?? null,
      row.photoByteLength ?? null,
      row.photoData ?? null,
      row.latitude ?? null,
      row.longitude ?? null,
    ],
  );

const PENDING = { codeHash: 'hash-1', status: 'PENDING' };
const completeProof = (overrides = {}) => ({
  status: 'VERIFIED',
  codeHash: 'hash-1',
  attemptsUsed: 1,
  otpVerifiedAt: new Date(),
  photoSha256: 'a'.repeat(64),
  photoContentType: 'image/jpeg',
  photoByteLength: 3,
  photoData: Buffer.from([1, 2, 3]),
  latitude: 23.81,
  longitude: 90.41,
  ...overrides,
});

await client.connect();
await client.query('BEGIN');

// A real job id keeps the proof inside a shipment the rest of the system can find, and the
// rollback below means nothing survives this file.
const {
  rows: [job],
} = await client.query(
  `INSERT INTO delivery.jobs (id, shipment_id, rider_id, status, attempts_made)
   VALUES ($1, $2, $3, 'OUT_FOR_DELIVERY', 0) RETURNING id`,
  [randomUUID(), randomUUID(), randomUUID()],
);
const jobId = job.id;

// A second job, because one job gets exactly one proof and the interesting states below are
// PENDING and VERIFIED at the same time. Sharing a job would just re-test the unique index.
const {
  rows: [job2],
} = await client.query(
  `INSERT INTO delivery.jobs (id, shipment_id, rider_id, status, attempts_made)
   VALUES ($1, $2, $3, 'OUT_FOR_DELIVERY', 0) RETURNING id`,
  [randomUUID(), randomUUID(), randomUUID()],
);
const verifiedJobId = job2.id;

console.log('\ndelivery.delivery_proofs\n');

const pendingId = randomUUID();
const pendingState = await sqlstate(() => insert(client, { ...PENDING, jobId, id: pendingId }));
check('a PENDING challenge with no photo, code hash or location is accepted', () => {
  assert.equal(pendingState, null);
});
{
  const { rows } = await client.query(
    `SELECT status, photo_sha256, latitude FROM delivery.delivery_proofs WHERE id = $1`,
    [pendingId],
  );
  check('and it really is PENDING with null evidence, not defaults pretending to be null', () => {
    assert.equal(rows[0].status, 'PENDING');
    assert.equal(rows[0].photo_sha256, null);
    assert.equal(rows[0].latitude, null);
  });
}

console.log('\nthe completeness rule (a CHECK, not a service)\n');

for (const [what, missing] of [
  ['no OTP verification timestamp', { otpVerifiedAt: null }],
  ['no photo digest', { photoSha256: null }],
  ['no photo bytes', { photoData: null }],
  ['no latitude', { latitude: null }],
  ['no longitude', { longitude: null }],
]) {
  const state = await sqlstate(() =>
    insert(client, { ...completeProof(missing), jobId, attemptsUsed: 1 }),
  );
  check(`a VERIFIED proof with ${what} is refused by the database`, () => {
    assert.equal(state, '23514', `expected check_violation 23514, got ${state}`);
  });
}

console.log('\nthe attempt budget\n');

{
  const state = await sqlstate(() => insert(client, { ...PENDING, jobId, attemptsUsed: 6 }));
  check('attempts_used = 6 (one past MAX_OTP_ATTEMPTS) violates the CHECK', () => {
    assert.equal(state, '23514');
  });
}
{
  const state = await sqlstate(() => insert(client, { ...PENDING, jobId, attemptsUsed: -1 }));
  check('a negative attempt count violates the CHECK too', () => {
    assert.equal(state, '23514');
  });
}

console.log('\nphotograph size\n');

{
  const state = await sqlstate(() =>
    insert(client, { ...completeProof({ photoByteLength: 3 * 1024 * 1024 }), jobId }),
  );
  check('a photo declaring 3 MB violates the size CHECK', () => {
    assert.equal(state, '23514');
  });
}
{
  const state = await sqlstate(() =>
    insert(client, { ...completeProof({ photoByteLength: 0 }), jobId }),
  );
  check('a photo declaring 0 bytes violates it as well — zero is not a photograph', () => {
    assert.equal(state, '23514');
  });
}

console.log('\nappend-only and immutability\n');

const verifiedId = randomUUID();
{
  const state = await sqlstate(() =>
    insert(client, { ...completeProof(), jobId: verifiedJobId, id: verifiedId }),
  );
  check('a complete VERIFIED proof is accepted', () => {
    assert.equal(state, null);
  });
}
{
  const state = await sqlstate(() =>
    client.query(`UPDATE delivery.delivery_proofs SET photo_sha256 = $1 WHERE id = $2`, [
      'b'.repeat(64),
      verifiedId,
    ]),
  );
  check('swapping the photo digest on a verified proof is refused', () => {
    assert.equal(state, '23001', `expected restrict_violation 23001, got ${state}`);
  });
}
{
  const state = await sqlstate(() =>
    client.query(`UPDATE delivery.delivery_proofs SET latitude = 0, longitude = 0 WHERE id = $1`, [
      verifiedId,
    ]),
  );
  check('moving a verified proof to null-island is refused', () => {
    assert.equal(state, '23001');
  });
}
{
  const state = await sqlstate(() =>
    client.query(`UPDATE delivery.delivery_proofs SET attempts_used = 0 WHERE id = $1`, [
      verifiedId,
    ]),
  );
  check('even refilling the attempt budget on a verified proof is refused', () => {
    assert.equal(state, '23001');
  });
}
{
  const state = await sqlstate(() =>
    client.query(`DELETE FROM delivery.delivery_proofs WHERE id = $1`, [verifiedId]),
  );
  check('deleting a verified proof is refused outright', () => {
    assert.equal(state, '23001');
  });
}

console.log('\nreissue\n');

{
  const state = await sqlstate(() =>
    client.query(`UPDATE delivery.delivery_proofs SET attempts_used = 1 WHERE id = $1`, [
      pendingId,
    ]),
  );
  check('a PENDING challenge can spend an attempt', () => {
    assert.equal(state, null);
  });
}
{
  const state = await sqlstate(() =>
    client.query(`UPDATE delivery.delivery_proofs SET attempts_used = 0 WHERE id = $1`, [
      pendingId,
    ]),
  );
  check(
    'resetting the budget WITHOUT rotating the code is refused — that is a free unlimited retry',
    () => {
      assert.equal(state, '23001');
    },
  );
}
{
  const state = await sqlstate(() =>
    client.query(
      `UPDATE delivery.delivery_proofs
         SET code_hash = $1, code_salt = $2, attempts_used = 0, code_issued_at = now()
       WHERE id = $3`,
      ['hash-2', 'salt-2', pendingId],
    ),
  );
  check('a real reissue — new hash, budget back to zero — is allowed', () => {
    assert.equal(state, null);
  });
}
{
  const state = await sqlstate(() =>
    client.query(`UPDATE delivery.delivery_proofs SET otp_verified_at = now() WHERE id = $1`, [
      pendingId,
    ]),
  );
  check('writing evidence onto a still-PENDING row is refused', () => {
    assert.equal(state, '23001');
  });
}

console.log('\nuniqueness\n');

{
  const state = await sqlstate(() => insert(client, { ...PENDING, jobId }));
  check('a second proof for the same job violates the unique index', () => {
    assert.equal(state, '23505', `expected unique_violation 23505, got ${state}`);
  });
}
{
  const state = await sqlstate(() => insert(client, { ...PENDING, jobId: randomUUID() }));
  check('a proof for a different job is fine', () => {
    assert.equal(state, null);
  });
}

await client.query('ROLLBACK');
await client.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
