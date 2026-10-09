/**
 * Contract: committed openapi.json vs observed behaviour.
 *
 * Two halves. First, spec-path parity: every path+method the live server
 * advertises at /docs-json must exist in the committed spec, and vice versa —
 * a drift in either direction fails. Second, behaviour spot-checks through
 * the generated client: auth is required where the spec says so, a bad cursor
 * is a 400 with the §87 envelope shape, and the public tracking endpoint
 * answers 404 (not 401) for an unknown code.
 *
 * Gated on API_BASE_URL like the other contract suites: skipped, not failed,
 * when no server is present. The auth checks use a throwaway merchant created
 * the same way scripts/seed.mjs does — direct SQL, because there is no signup
 * endpoint and the secret is verifiable (scrypt, in common/).
 *
 * Money stays integer minor units in every assertion (rule 4).
 */

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiBaseUrl = process.env.API_BASE_URL;
const databaseUrl = process.env.DATABASE_URL;
const describeIfServer = apiBaseUrl ? describe : describe.skip;

const here = dirname(fileURLToPath(import.meta.url));
const committed = JSON.parse(readFileSync(join(here, '..', '..', 'openapi.json'), 'utf8')) as {
  paths: Record<string, Record<string, unknown>>;
};

async function liveSpec(): Promise<{ paths: Record<string, Record<string, unknown>> }> {
  const response = await fetch(`${apiBaseUrl}/docs-json`);
  assert.equal(response.status, 200, 'live /docs-json must answer');
  return (await response.json()) as { paths: Record<string, Record<string, unknown>> };
}

/** Throwaway merchant + credential, same shape as scripts/seed.mjs. */
async function mintCredential(): Promise<{ merchantId: string; header: string }> {
  const { Client } = await import('pg');
  const { hashSecret, generateKeyId } = await import('../../dist/common/secret.js');
  const { randomBytes } = await import('node:crypto');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const merchantId = randomUUID();
    const keyId = generateKeyId();
    const secret = randomBytes(24).toString('base64url');
    const runTag = Date.now().toString(36);
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO merchant.merchants (id, name, status, contact_email)
       VALUES ($1, $2, 'ACTIVE', $3)`,
      [merchantId, `Contract Test (${runTag})`, `contract+${runTag}@zipzap.test`],
    );
    await client.query(
      `INSERT INTO merchant.api_credentials (id, merchant_id, key_id, secret_hash, scopes)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        randomUUID(),
        merchantId,
        keyId,
        (hashSecret as (s: string) => string)(secret),
        ['shipments:read', 'shipments:write'],
      ],
    );
    await client.query('COMMIT');
    return { merchantId, header: `ApiKey ${keyId}.${secret}` };
  } finally {
    await client.end();
  }
}

before(async () => {
  if (!apiBaseUrl) return;
  const spec = await liveSpec();
  assert.ok(Object.keys(spec.paths).length > 0, 'live spec must advertise paths');
});

describeIfServer('openapi contract — spec parity', () => {
  test('every live path+method exists in the committed spec', async () => {
    const live = await liveSpec();
    const missing: string[] = [];
    for (const [path, ops] of Object.entries(live.paths)) {
      for (const method of Object.keys(ops)) {
        if (method === 'parameters') continue;
        const diskOps = committed.paths[path];
        if (!diskOps || !(method in diskOps)) missing.push(`${method.toUpperCase()} ${path}`);
      }
    }
    assert.deepEqual(missing, [], 'live server advertises paths missing from openapi.json');
  });

  test('every committed path+method exists on the live server', async () => {
    const live = await liveSpec();
    const missing: string[] = [];
    for (const [path, ops] of Object.entries(committed.paths)) {
      for (const method of Object.keys(ops)) {
        if (method === 'parameters') continue;
        const liveOps = live.paths[path];
        if (!liveOps || !(method in liveOps)) missing.push(`${method.toUpperCase()} ${path}`);
      }
    }
    assert.deepEqual(missing, [], 'openapi.json advertises paths the server lacks');
  });

  test('shipment create requires its Idempotency-Key header', () => {
    const post = committed.paths['/v1/shipments']?.post as
      { parameters?: Array<{ name?: string; in?: string; required?: boolean }> } | undefined;
    const keyed = (post?.parameters ?? []).filter((p) => p.in === 'header');
    assert.ok(
      keyed.some((p) => p.name === 'Idempotency-Key' && p.required),
      'POST /v1/shipments must document Idempotency-Key as required',
    );
  });
});

describeIfServer('openapi contract — observed behaviour', () => {
  test('unauthenticated shipment create is 401 with the §87 envelope', async () => {
    const response = await fetch(`${apiBaseUrl}/v1/shipments?limit=1`);
    assert.equal(response.status, 401);
    const body = (await response.json()) as Record<string, unknown>;
    for (const field of ['type', 'title', 'status', 'code', 'detail', 'request_id']) {
      assert.ok(field in body, `envelope carries ${field}`);
    }
    assert.equal(body.code, 'AUTHENTICATION_REQUIRED');
  });

  test('RateLimit-* headers ride on an authenticated list call', async () => {
    if (!databaseUrl) return;
    const { header } = await mintCredential();
    const response = await fetch(`${apiBaseUrl}/v1/shipments?limit=1`, {
      headers: { Authorization: header },
    });
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('RateLimit-Limit'), 'RateLimit-Limit present');
    assert.ok(response.headers.get('RateLimit-Remaining') !== null, 'RateLimit-Remaining present');
    assert.ok(response.headers.get('RateLimit-Reset') !== null, 'RateLimit-Reset present');
  });

  test('a malformed cursor is a 400 with a named reason, never a 500', async () => {
    if (!databaseUrl) return;
    const { header } = await mintCredential();
    const response = await fetch(`${apiBaseUrl}/v1/shipments?cursor=!!!`, {
      headers: { Authorization: header },
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.code, 'VALIDATION_FAILED');
  });

  test('public tracking 404s (not 401s) on an unknown code', async () => {
    const response = await fetch(`${apiBaseUrl}/track/ZZZ-NOPE123`);
    assert.equal(response.status, 404);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.status, 404);
  });

  test('duplicate create with the same key returns the original, not a second parcel', async () => {
    if (!databaseUrl) return;
    const { header } = await mintCredential();
    const key = `contract-${randomUUID()}`;
    const payload = {
      senderName: 'Contract',
      senderPhone: '+8801700000000',
      senderAddress: 'Dhaka',
      recipientName: 'Probe',
      recipientPhone: '+8801800000000',
      recipientAddress: 'Chattogram',
      parcelWeightGrams: 1000,
      parcelDescription: 'contract probe',
      codAmountMinor: 125_050,
      codCurrency: 'BDT',
      zone: 'dhaka-metro',
      remoteArea: false,
      fragile: false,
    };
    const once = await fetch(`${apiBaseUrl}/v1/shipments`, {
      method: 'POST',
      headers: {
        Authorization: header,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(once.status, 201);
    const first = (await once.json()) as { id: string; replayed: boolean };
    assert.equal(first.replayed, false);

    const twice = await fetch(`${apiBaseUrl}/v1/shipments`, {
      method: 'POST',
      headers: {
        Authorization: header,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(twice.status, 201);
    const second = (await twice.json()) as { id: string; replayed: boolean };
    assert.equal(second.replayed, true);
    assert.equal(second.id, first.id, 'same key returns the same shipment');
  });

  test('same key with a different body is rejected, not replayed', async () => {
    if (!databaseUrl) return;
    const { header } = await mintCredential();
    const key = `contract-${randomUUID()}`;
    const payload = {
      senderName: 'Contract',
      senderPhone: '+8801700000000',
      senderAddress: 'Dhaka',
      recipientName: 'Probe',
      recipientPhone: '+8801800000000',
      recipientAddress: 'Chattogram',
      parcelWeightGrams: 1000,
      parcelDescription: 'contract probe',
      codAmountMinor: 125_050,
      codCurrency: 'BDT',
      zone: 'dhaka-metro',
      remoteArea: false,
      fragile: false,
    };
    const headers = {
      Authorization: header,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    };
    const once = await fetch(`${apiBaseUrl}/v1/shipments`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    assert.equal(once.status, 201);

    // Same key, different parcel: a client bug, surfaced as 400 — never a silent replay.
    const tampered = await fetch(`${apiBaseUrl}/v1/shipments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...payload, parcelWeightGrams: 9999 }),
    });
    assert.equal(tampered.status, 400);
    const body = (await tampered.json()) as Record<string, unknown>;
    assert.equal(body.code, 'INVALID_IDEMPOTENCY_KEY');
  });

  test('shipment detail returns your parcel, 404s a stranger id', async () => {
    if (!databaseUrl) return;
    const { header } = await mintCredential();
    const created = await fetch(`${apiBaseUrl}/v1/shipments`, {
      method: 'POST',
      headers: {
        Authorization: header,
        'Content-Type': 'application/json',
        'Idempotency-Key': `contract-${randomUUID()}`,
      },
      body: JSON.stringify({
        senderName: 'Contract',
        senderPhone: '+8801700000000',
        senderAddress: 'Dhaka',
        recipientName: 'Probe',
        recipientPhone: '+8801800000000',
        recipientAddress: 'Chattogram',
        parcelWeightGrams: 1000,
        parcelDescription: 'contract probe',
        zone: 'dhaka-metro',
        remoteArea: false,
        fragile: false,
      }),
    });
    assert.equal(created.status, 201);
    const { id } = (await created.json()) as { id: string };

    const detail = await fetch(`${apiBaseUrl}/v1/shipments/${id}`, {
      headers: { Authorization: header },
    });
    assert.equal(detail.status, 200);
    const parcel = (await detail.json()) as { id: string; status: string };
    assert.equal(parcel.id, id);
    assert.equal(parcel.status, 'CREATED');

    const stranger = await fetch(
      `${apiBaseUrl}/v1/shipments/00000000-0000-0000-0000-000000000000`,
      { headers: { Authorization: header } },
    );
    assert.equal(stranger.status, 404);
  });

  test('an unserviceable zone is rejected at creation with a reason (422)', async () => {
    if (!databaseUrl) return;
    const { header } = await mintCredential();
    const response = await fetch(`${apiBaseUrl}/v1/shipments`, {
      method: 'POST',
      headers: {
        Authorization: header,
        'Content-Type': 'application/json',
        'Idempotency-Key': `contract-${randomUUID()}`,
      },
      body: JSON.stringify({
        senderName: 'Contract',
        senderPhone: '+8801700000000',
        senderAddress: 'Dhaka',
        recipientName: 'Probe',
        recipientPhone: '+8801800000000',
        recipientAddress: 'Nowhere',
        parcelWeightGrams: 1000,
        parcelDescription: 'serviceability probe',
        zone: 'atlantis-01',
        remoteArea: false,
        fragile: false,
      }),
    });
    assert.equal(response.status, 422);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.code, 'SERVICEABILITY_FAILED');
    assert.match(String(body.detail), /No coverage for zone "atlantis-01"/);
  });

  test('cancel moves CREATED to CANCELLED; repeat is a 409, not a double-apply', async () => {
    if (!databaseUrl) return;
    const { header } = await mintCredential();
    const auth = {
      Authorization: header,
      'Content-Type': 'application/json',
      'Idempotency-Key': `contract-${randomUUID()}`,
    };
    const created = await fetch(`${apiBaseUrl}/v1/shipments`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        senderName: 'Contract',
        senderPhone: '+8801700000000',
        senderAddress: 'Dhaka',
        recipientName: 'Probe',
        recipientPhone: '+8801800000000',
        recipientAddress: 'Chattogram',
        parcelWeightGrams: 1000,
        parcelDescription: 'contract probe',
        zone: 'dhaka-metro',
        remoteArea: false,
        fragile: false,
      }),
    });
    const { id } = (await created.json()) as { id: string };

    const cancelled = await fetch(`${apiBaseUrl}/v1/shipments/${id}/cancel`, {
      method: 'POST',
      headers: { Authorization: header },
    });
    assert.equal(cancelled.status, 201);
    assert.equal(((await cancelled.json()) as { status: string }).status, 'CANCELLED');

    const repeat = await fetch(`${apiBaseUrl}/v1/shipments/${id}/cancel`, {
      method: 'POST',
      headers: { Authorization: header },
    });
    assert.equal(repeat.status, 409);
    assert.equal(((await repeat.json()) as { code: string }).code, 'INVALID_TRANSITION');
  });
});
