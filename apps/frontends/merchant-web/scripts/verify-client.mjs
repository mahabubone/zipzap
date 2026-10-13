/**
 * Exercises the real ZipZapClient against the running backend and asserts the
 * decoded values the console screens render. This is the contract between the
 * client and the UI — if a controller changes shape, this fails.
 *
 * `API_ORIGIN`, not `VITE_API_URL`: this script runs in Node, not in a browser, so it legitimately
 * knows the API's address. The browser does not, and must not — see the note in
 * `src/lib/api.ts`.
 *
 * Run: SEED_CONSOLE_EMAIL=... SEED_CONSOLE_PASSWORD=... node apps/web/scripts/verify-client.mjs
 */
import { ZipZapClient } from '@zipzap/api-client';

const API = process.env.API_ORIGIN ?? 'http://localhost:3000';
const EMAIL = process.env.SEED_CONSOLE_EMAIL;
const PASSWORD = process.env.SEED_CONSOLE_PASSWORD;

/**
 * The control tower's operator, and it is a *different person*.
 *
 * The section below that reads `/v1/dashboard/live-counts` is about what the operations console
 * renders, and that endpoint needs `network:read` — which a merchant does not hold, deliberately: a
 * shop's owner has no business knowing the whole network's numbers.
 *
 * So this script signs in twice, with the two credentials the seed mints for exactly this split, and
 * uses each where it belongs. It used to use the merchant for both and died on a `403 Missing scope
 * network:read` — which is the server being correctly strict, reported by a script as though the server
 * were broken.
 *
 * And the refusal itself is worth asserting: a client that silently showed empty counts for a
 * permission it lacked would be a much worse bug than this one.
 */
const OPS_EMAIL = process.env.SEED_OPS_EMAIL;
const OPS_PASSWORD = process.env.SEED_OPS_PASSWORD;

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`,
  );
}

// `loginToken`, not `login`.
//
// `/v1/auth/login` exists for a browser: the token arrives in an `HttpOnly` cookie that script cannot
// read, and the response body deliberately carries no token at all (ADR-0016). This script is not a
// browser and has nowhere to keep a cookie, so it uses the other half of the same session — which is
// what `/v1/auth/token` is for.
//
// It used to call `login` and read `session.token`. The client's return type claimed a `token: string`
// that the server never sends, so it sent `Authorization: Bearer undefined` and the proof died on a
// 401 that said nothing about authentication. The type is now the generated schema, which has no
// `token` field, so this cannot compile again.
const session = await new ZipZapClient({ baseUrl: API }).loginToken(EMAIL, PASSWORD);
const client = new ZipZapClient({ baseUrl: API, bearerToken: session.token });
check(
  'the token endpoint hands back a token, unlike the cookie one',
  typeof session.token,
  'string',
);

// --- what ConsoleLayout reads on every page ---------------------------------
const me = await client.getMe();
check('getMe resolves to a principal', typeof me.subjectId, 'string');
check('scopes came back as an array', Array.isArray(me.scopes), true);

// --- what the control tower renders -----------------------------------------
// Refused first, on purpose, and asserted as a refusal: `network:read` is not a merchant scope, and
// the client should surface that as an error rather than return a page of zeroes that an operator would
// read as "nothing is moving".
let refused = false;
try {
  await client.liveCounts();
} catch (error) {
  refused = error?.envelope?.code === 'PERMISSION_DENIED';
}
check('a merchant cannot read the whole network', refused, true);

const ops = new ZipZapClient({ baseUrl: API });
const opsSession = await ops.loginToken(OPS_EMAIL, OPS_PASSWORD);
const opsClient = new ZipZapClient({ baseUrl: API, bearerToken: opsSession.token });
const counts = await opsClient.liveCounts();
check('liveCounts typed shape reached the client', typeof counts.shipments.todayNew, 'number');
check('hub group survives decoding', typeof counts.hub.networkHubs, 'number');
check('COD byStatus decoded', typeof counts.cod.byStatus.COD_EXPECTED, 'number');

// --- what the shipments table renders ---------------------------------------
const page = await client.listShipments({ limit: '5' });
check('listShipments unwraps nextCursor', typeof page.nextCursor, 'string');
check('listShipments unwraps hasMore', typeof page.hasMore, 'boolean');
check('rows carry a status to badge', typeof page.data[0].status, 'string');

// --- what the detail screen renders -----------------------------------------
const detail = await client.getShipment(page.data[0].id);
check('getShipment matches the list row', detail.trackingCode, page.data[0].trackingCode);
check('weight is an integer', Number.isInteger(detail.parcelWeightGrams), true);

// --- what the track screen renders ------------------------------------------
const tracked = await new ZipZapClient({ baseUrl: API }).track(detail.trackingCode);
check('track needs no session', tracked.trackingCode, detail.trackingCode);
check('timeline entries carry a sequence', typeof tracked.timeline[0]?.sequence, 'number');

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
