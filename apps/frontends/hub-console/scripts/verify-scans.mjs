/**
 * The scan vocabulary, asserted without a test framework.
 *
 * hub-console has no vitest and this does not add one: the frontend convention in this repo is a
 * zero-dependency `verify-*.mjs` script (see merchant-web/scripts/verify-money.mjs). This one
 * exists because a raw enum reaching a loading dock is a bug that has already happened once — the
 * Stage 2 proof caught `INBOUND` rendering verbatim in a table cell — and because the five kinds
 * must stay in the order the belt actually runs them.
 *
 * Run: node apps/frontends/hub-console/scripts/verify-scans.mjs
 */
import { SCAN_LABELS, formatAgo, formatClock, scanAction, statusLabel } from '../src/lib/scans.ts';

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

// Every kind the client can send is labelled, and nothing else is. A new kind added to the
// backend but not here fails `scanAction` below rather than shipping `INBOUND` to the dock.
check('five kinds', Object.keys(SCAN_LABELS), [
  'INBOUND',
  'SORT',
  'OUTBOUND',
  'DEPARTED',
  'ARRIVED',
]);

// Belt order — the machine's order, which is the physical order.
check('INBOUND reads as Inbound', SCAN_LABELS.INBOUND, 'Inbound');
check('DEPARTED is not "Line haul left"', SCAN_LABELS.DEPARTED, 'Departed');

// The button says what it does. An operator reads the verb, not the kind.
check('button names the gesture', scanAction('OUTBOUND'), 'Scan outbound');
check('button lowercases the label', scanAction('ARRIVED'), 'Scan arrived');

// An unknown kind degrades to a generic verb rather than echoing `RAW_ENUM` back at the user.
// The server rejects it anyway; the point is that the label never leaks.
check('unknown kind does not leak the enum', scanAction('TELEPORTED'), 'Scan');

// Shipment statuses, same rule — these are read on every parcel card.
check('PICKED_UP reads as words', statusLabel('PICKED_UP'), 'Picked up');
check('AT_DESTINATION_HUB reads as words', statusLabel('AT_DESTINATION_HUB'), 'At destination hub');
check('unknown status degrades without underscores', statusLabel('SOMETHING_NEW'), 'something new');

// The manifest vocabulary, read side by side with the shipment one on the same screen. Every one of
// these was lowercased by the fallback until the browser proof caught it.
check('DRAFT', statusLabel('DRAFT'), 'Draft');
check('SEALED', statusLabel('SEALED'), 'Sealed');
check('RECEIVED', statusLabel('RECEIVED'), 'Received');
check('RECONCILED', statusLabel('RECONCILED'), 'Reconciled');
check(
  'no manifest status falls through to the lowercase fallback',
  ['DRAFT', 'SEALED', 'DISPATCHED', 'RECEIVED', 'RECONCILED'].filter(
    (k) => statusLabel(k) === k.toLowerCase(),
  ),
  [],
);
check(
  'DISPATCHED reads the same in both vocabularies, because it is the same word',
  statusLabel('DISPATCHED'),
  'Dispatched',
);

// A clock, fixed to Dhaka, no day or month.
check('clock is HH:MM', formatClock('2026-10-07T16:39:47.960Z').length, 5);
check('clock uses Dhaka', formatClock('2026-10-07T16:39:47.960Z'), '22:39');

// A loading dock cares how long a parcel has been sitting, not what day it was.
const now = Date.parse('2026-10-09T12:00:00.000Z');
check('just now', formatAgo('2026-10-09T11:59:30.000Z', now), 'just now');
check('minutes', formatAgo('2026-10-09T11:45:00.000Z', now), '15 min ago');
check('hours', formatAgo('2026-10-09T06:00:00.000Z', now), '6 h ago');
check('days', formatAgo('2026-10-07T12:00:00.000Z', now), '2 d ago');
// A parcel scanned "in the future" means clock skew on a cheap tablet, not a negative age.
check('skewed clock never goes negative', formatAgo('2026-10-09T12:05:00.000Z', now), 'just now');

console.log(failures === 0 ? '\nscan vocabulary ok' : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);