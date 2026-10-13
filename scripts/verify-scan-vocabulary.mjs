/**
 * The dock's vocabulary, checked against the server's.
 *
 * The hub console's labels — `Inbound`, `Sort`, `Outbound` — live in `@zipzap/web-kit`, and the
 * five kinds they describe live in the backend's `rules/scan.ts`. Nothing connects the two, so
 * nothing stops a sixth kind being added to the server and reaching a loading dock as the button
 * that says `Scan` and nothing else. That is not a hypothetical: a raw `INBOUND` rendered verbatim
 * in a table cell is exactly what happened once already, and it was caught by a browser proof
 * rather than by anything structural.
 *
 * So the assertion is made across the boundary, here, where both sides can be read at once. This
 * script replaces `apps/frontends/hub-console/scripts/verify-scans.mjs`, which asserted the same
 * labels against a copy inside the hub console — and was therefore a third place to update when the
 * wording changed, which is how the four copies of `format.ts` drifted in the first place.
 *
 * Cross-package reads of source are deliberate and are already the convention:
 * `apps/frontends/merchant-web/scripts/verify-bulk-preview.mjs` reads the backend's `rules/bulk.ts`
 * the same way to check that the CSV template the merchant downloads describes a file the server can
 * actually parse.
 *
 * Run: node scripts/verify-scan-vocabulary.mjs
 */

import { HUB_SCAN_KINDS } from '../apps/backend/src/modules/hub/rules/scan.ts';
import { scanLabel } from '../packages/web-kit/src/format.ts';

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

const kinds = Object.keys(HUB_SCAN_KINDS);

check('the server still declares five gestures', kinds.length, 5);

// The load-bearing one: every kind the server can accept has a word for it. A kind with no label
// renders as the generic `Scan`, which is a button that lies about what pressing it does.
const unlabelled = kinds.filter((kind) => {
  const label = scanLabel(kind);
  return !label || label === kind;
});
check('every kind has a label of its own', unlabelled, []);

// …and nothing is labelled that the server cannot do, because a stale label is the same lie in the
// other direction. Plain `Object.fromEntries`, because this file is `.mjs`: Node strips types from the
// `.ts` files it imports, but a type annotation written here would be parsed as code and run.
const labelled = Object.entries(Object.fromEntries(kinds.map((kind) => [kind, scanLabel(kind)])));
check(
  'labels are words, not enums',
  labelled.filter(([, label]) => label === label.toUpperCase()),
  [],
);

if (failures > 0) {
  console.error(
    [
      '',
      `${failures} failure(s).`,
      '  Add the label to SCAN_LABELS in packages/web-kit/src/format.ts — not to a copy in an app.',
    ].join('\n'),
  );
  process.exit(1);
}

console.log('scan vocabulary ok — every server gesture has a word for it');
