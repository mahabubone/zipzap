/**
 * The status filter must cover the state machine. Asserted without a test
 * framework, same convention as verify-phone.mjs and verify-cursor-stack.mjs.
 *
 * The check that matters reads the BACKEND's SHIPMENT_STATUSES out of
 * state-machine.ts. A hand-copied list in this file would drift silently, and
 * the symptom is invisible: the console keeps working, it just stops offering a
 * filter for a status that now exists. That is the kind of bug nobody reports
 * and everybody hits.
 *
 * Run: node apps/frontends/merchant-web/scripts/verify-status-groups.mjs
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HIDDEN_STATUSES, STATUS_GROUPS, statusesOf } from '../src/lib/statusGroups.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${
      ok ? '' : `\n        got ${JSON.stringify(actual)}  want ${JSON.stringify(expected)}`
    }`,
  );
}

const here = fileURLToPath(new URL('.', import.meta.url));
const stateMachine = fs.readFileSync(
  here + '../../../backend/src/modules/shipment/rules/state-machine.ts',
  'utf8',
);
const block = stateMachine.match(/SHIPMENT_STATUSES = \[([\s\S]*?)\] as const/);
if (!block) throw new Error('could not read SHIPMENT_STATUSES from the backend state machine');
const BACKEND = [...block[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);

check('the backend state machine was found', BACKEND.length > 0, true);

const grouped = STATUS_GROUPS.flatMap((g) => statusesOf(g.value));
const covered = [...grouped, ...HIDDEN_STATUSES];

const missing = BACKEND.filter((s) => !covered.includes(s));
check('every backend status is either a filter or explicitly hidden', missing, []);

const unknown = covered.filter((s) => !BACKEND.includes(s));
check('no filter names a status the backend does not have', unknown, []);

const dupes = covered.filter((s, i) => covered.indexOf(s) !== i);
check('no status is in two groups at once', dupes, []);

check('"All statuses" sends no status filter', statusesOf(''), []);
check('a group expands to its statuses', statusesOf('LOST,DAMAGED'), ['LOST', 'DAMAGED']);
check('the first group is the empty one', STATUS_GROUPS[0].value, '');
check(
  'every group has a label',
  STATUS_GROUPS.every((g) => g.label !== ''),
  true,
);
check(
  'every group but the first is non-empty',
  STATUS_GROUPS.slice(1).every((g) => statusesOf(g.value).length > 0),
  true,
);
check(
  'group values are what the server receives, with no stray spaces',
  STATUS_GROUPS.slice(1).every((g) => g.value === statusesOf(g.value).join(',')),
  true,
);

// "Delivered" is the one status a merchant looks for by name; a merchant who
// cannot filter to delivered will export the whole account and filter in Excel.
check('delivered is reachable in one click', grouped.includes('DELIVERED'), true);
check(
  'the statuses that cost money are reachable',
  ['LOST', 'DAMAGED', 'CANCELLED'].every((s) => grouped.includes(s)),
  true,
);

if (failures > 0) {
  console.error(`\nstatus groups: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nstatus groups ok');
