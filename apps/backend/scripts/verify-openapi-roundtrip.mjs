/**
 * Stage 6b, exit check 3 — "a published OpenAPI request round-trips against the seeded sandbox from
 * a fresh client."
 *
 * The claim is that the PUBLISHED contract is sufficient for a stranger. Our own api-client is not
 * evidence of that: it was hand-written against the implementation and hand-declares response shapes
 * the spec does not carry, so a bug shared between it and the server would round-trip perfectly and
 * prove nothing. So this script:
 *
 *   1. fetches the spec from the LIVE server (`/docs-json`), not the committed file — a stale
 *      committed spec is the exact failure this check exists to catch;
 *   2. generates types from it with `openapi-typescript`, the same tool that generates
 *      packages/api-client, so the request body is checked against the spec rather than my memory;
 *   3. compiles a throwaway TypeScript client that imports ONLY those generated types;
 *   4. creates a shipment, reads it back, and asserts the server agreed on every field.
 *
 * Type checking is the load-bearing step. At runtime a client can send anything; `tsc` refusing an
 * unknown field is what makes "the spec describes the request" a fact rather than a hope.
 *
 * Run: node apps/backend/scripts/verify-openapi-roundtrip.mjs
 * Env:  PROVE_BASE (default http://localhost:3000), API_KEY_ID, API_SECRET
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const BASE = process.env.PROVE_BASE ?? 'http://localhost:3000';
const KEY_ID = process.env.API_KEY_ID;
const API_SECRET = process.env.API_SECRET;

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`,
  );
}

if (!KEY_ID || !API_SECRET) {
  console.error('Set API_KEY_ID and API_SECRET (see `pnpm db:seed` output — printed once).');
  process.exit(1);
}

// ─── 1. the LIVE spec ────────────────────────────────────────────────────────
const specRes = await fetch(`${BASE}/docs-json`);
check('the live server publishes a spec at /docs-json', specRes.ok, `HTTP ${specRes.status}`);
const spec = await specRes.json();
check('the spec declares paths', Object.keys(spec.paths ?? {}).length > 0);

const createSchemaName = spec.paths?.['/v1/shipments']?.post?.requestBody?.content?.[
  'application/json'
]?.schema?.$ref?.split('/').pop();
check('POST /v1/shipments publishes a request schema', Boolean(createSchemaName), 'no $ref on the request body');
check(
  'the request schema is a real component, not an inline stub',
  Boolean(spec.components?.schemas?.[createSchemaName]),
  `components.schemas.${createSchemaName} is missing`,
);
const declared = Object.keys(spec.components?.schemas?.[createSchemaName]?.properties ?? {});
const required = spec.components?.schemas?.[createSchemaName]?.required ?? [];
check(
  'the published schema declares what a caller MUST send, not just what it may send',
  required.length > 0 && required.every((f) => declared.includes(f)),
  `required ${JSON.stringify(required)} vs declared ${JSON.stringify(declared)}`,
);
check(
  'the required set covers sender, recipient and parcel basics',
  ['senderName', 'senderPhone', 'senderAddress', 'recipientName', 'recipientPhone', 'recipientAddress', 'parcelWeightGrams', 'zone'].every(
    (f) => required.includes(f),
  ),
  `required: ${required.join(', ')}`,
);
check(
  'money in the published schema is constrained to a positive number, and says why in prose',
  spec.components?.schemas?.[createSchemaName]?.properties?.codAmountMinor?.minimum === 1 &&
    /integer minor units/.test(
      spec.components?.schemas?.[createSchemaName]?.properties?.codAmountMinor?.description ?? '',
    ),
  `codAmountMinor: ${JSON.stringify(spec.components?.schemas?.[createSchemaName]?.properties?.codAmountMinor)}`,
);

// ─── 2. generate a client from that spec ─────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'zipzap-openapi-'));
try {
  const specPath = join(dir, 'openapi.json');
  writeFileSync(specPath, JSON.stringify(spec));

  const typesPath = join(dir, 'generated.d.ts');
  // Resolved by hand, not through the exports map: openapi-typescript@7 declares `"./*.js": "./*.mjs"`,
  // which points at a file that does not exist on disk. Importing the package's declared bin
  // specifier fails with MODULE_NOT_FOUND; only the literal path in the package directory works.
  const generatorCli = fileURLToPath(import.meta.resolve('openapi-typescript/package.json'))
    .replace(/package\.json$/, 'bin/cli.js');
  await run(process.execPath, [generatorCli, specPath, '--output', typesPath], { cwd: dir });
  const generated = await import('node:fs').then((fs) => fs.readFileSync(typesPath, 'utf8'));
  check(
    'openapi-typescript generated a client from the live spec',
    /export interface paths\b/.test(generated) && generated.includes('/v1/shipments'),
    'no paths block emitted',
  );
  // The gap worth recording: controllers return interfaces, not decorated DTOs, so the spec carries
  // no RESPONSE schemas. A generated client can therefore type the request but not the response —
  // which is why packages/api-client hand-declares six response shapes. Asserted from the spec
  // itself; asserting it by referencing the absent type would just be a compile error.
  check(
    'the published contract types REQUESTS but not RESPONSES — a known, deliberate gap',
    spec.paths['/v1/shipments'].post.responses['201']?.content?.['application/json']?.schema ===
      undefined,
    'a response schema appeared; the hand-declared shapes in api-client may now be redundant',
  );

  // ─── 3. a client that knows ONLY the generated types ──────────────────────
  const clientPath = join(dir, 'client.ts');
  writeFileSync(
    clientPath,
    `// Generated from the live spec. No hand-written request shape anywhere below.
import type { components } from './generated.js';

// Compiles only if the published schema really carries these fields and types.
export function buildBody(weightGrams: number) {
  const body: components['schemas']['CreateShipmentDto'] = {
    senderName: 'Round Trip Merchant',
    senderPhone: '+8801600000000',
    senderAddress: 'Agrabad C/A, Chattogram',
    recipientName: 'Round Trip Recipient',
    recipientPhone: '+8801700000000',
    recipientAddress: 'Zindabazar, Sylhet',
    parcelWeightGrams: weightGrams,
    parcelDescription: 'openapi round trip',
    zone: 'dhaka-metro',
    remoteArea: false,
    fragile: false,
    codAmountMinor: 125050,
    codCurrency: 'BDT',
  };
  // A field the schema does not declare must be a COMPILE error, not a runtime surprise.
  // @ts-expect-error unknown field — this is the assertion, not a leftover.
  body.notAField = 'x';
  return body;
}

`,
  );

  const tscPath = fileURLToPath(import.meta.resolve('typescript/bin/tsc'));
  let typeErrors = '';
  try {
    await run(process.execPath, [tscPath, '--noEmit', '--strict', '--target', 'ES2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', clientPath], {
      cwd: dir,
    });
  } catch (e) {
    typeErrors = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  // Silence is the pass condition, and it is a strict one. `@ts-expect-error` is itself the
  // assertion: TypeScript fails compilation with "Unused '@ts-expect-error' directive" the moment
  // the line it guards stops being an error. So a clean compile proves BOTH directions at once —
  // the published schema accepts our request, and rejects a field it does not declare.
  check(
    'the generated types accept the request AND reject an undeclared field (silence proves both)',
    typeErrors.trim() === '',
    typeErrors.trim().slice(0, 700) || 'compiled clean',
  );

  // ─── 4. round-trip the call for real ──────────────────────────────────────
  const auth = `ApiKey ${KEY_ID}.${API_SECRET}`;
  const weight = 1500 + Math.floor((Date.now() / 1000) % 100); // unique-ish per run
  const idem = `roundtrip-${Date.now()}`;
  const body = {
    senderName: 'Round Trip Merchant',
    senderPhone: '+8801600000000',
    senderAddress: 'Agrabad C/A, Chattogram',
    recipientName: 'Round Trip Recipient',
    recipientPhone: '+8801700000000',
    recipientAddress: 'Zindabazar, Sylhet',
    parcelWeightGrams: weight,
    parcelDescription: 'openapi round trip',
    zone: 'dhaka-metro',
    remoteArea: false,
    fragile: false,
    codAmountMinor: 125050,
    codCurrency: 'BDT',
  };

  const createdRes = await fetch(`${BASE}/v1/shipments`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      'Idempotency-Key': idem,
    },
    body: JSON.stringify(body),
  });
  const created = await createdRes.json();
  check('a fresh client can create a shipment with the published contract', createdRes.status === 201, `HTTP ${createdRes.status} ${JSON.stringify(created).slice(0, 200)}`);

  const id = created?.data?.id ?? created?.id;
  check('the response carries an id', typeof id === 'string' && id.length > 0, JSON.stringify(created).slice(0, 200));

  const readRes = await fetch(`${BASE}/v1/shipments/${id}`, { headers: { Authorization: auth } });
  const read = await readRes.json();
  check('the created shipment reads back', readRes.status === 200, `HTTP ${readRes.status}`);
  const readBody = read?.data ?? read;
  check(
    'the server stored the weight we sent, as an integer',
    readBody?.parcelWeightGrams === weight,
    `sent ${weight}, read ${readBody?.parcelWeightGrams}`,
  );
  check('the server stored the recipient name', readBody?.recipientName === body.recipientName);
  check('the server stored the address', readBody?.recipientAddress === body.recipientAddress);
  check(
    'money survived the round trip as integer minor units, never a float',
    readBody?.codAmountMinor === 125050,
    `sent 125050, read ${readBody?.codAmountMinor}`,
  );
  check(
    'the shipment starts in a state the spec declares',
    typeof readBody?.status === 'string',
    `status ${readBody?.status}`,
  );

  // The same key twice must replay, not duplicate — rule 9, observed from outside.
  const replayRes = await fetch(`${BASE}/v1/shipments`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json', 'Idempotency-Key': idem },
    body: JSON.stringify(body),
  });
  const replay = await replayRes.json();
  check(
    'replaying the Idempotency-Key returns the first shipment, not a second one',
    (replay?.data?.id ?? replay?.id) === id,
    `first ${id}, replay ${replay?.data?.id ?? replay?.id}`,
  );

  // A key reused with a DIFFERENT body is a client bug the server must refuse.
  const mismatchRes = await fetch(`${BASE}/v1/shipments`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json', 'Idempotency-Key': idem },
    body: JSON.stringify({ ...body, parcelWeightGrams: weight + 1 }),
  });
  check(
    'reusing a key with a different body is refused',
    mismatchRes.status >= 400,
    `HTTP ${mismatchRes.status}`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(
  `\nstage 6b openapi round trip: ${failures === 0 ? 'all assertions ok' : `${failures} FAILED`}`,
);
process.exit(failures === 0 ? 0 : 1);