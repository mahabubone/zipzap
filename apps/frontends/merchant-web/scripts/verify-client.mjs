/**
 * Exercises the real ZipZapClient against the running backend and asserts the
 * decoded values the console screens render. This is the contract between the
 * client and the UI — if a controller changes shape, this fails.
 *
 * Run: SEED_CONSOLE_EMAIL=... SEED_CONSOLE_PASSWORD=... node apps/web/scripts/verify-client.mjs
 */
import { ZipZapClient } from '@zipzap/api-client';

const API = process.env.VITE_API_URL ?? 'http://localhost:3000';
const EMAIL = process.env.SEED_CONSOLE_EMAIL;
const PASSWORD = process.env.SEED_CONSOLE_PASSWORD;

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`,
  );
}

// The anon client is what the login screen and the public tracker use.
const session = await new ZipZapClient({ baseUrl: API }).login(EMAIL, PASSWORD);
const client = new ZipZapClient({ baseUrl: API, bearerToken: session.token });

// --- what ConsoleLayout reads on every page ---------------------------------
const me = await client.getMe();
check('getMe resolves to a principal', typeof me.subjectId, 'string');
check('scopes came back as an array', Array.isArray(me.scopes), true);

// --- what the control tower renders -----------------------------------------
const counts = await client.liveCounts();
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
