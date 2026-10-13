/**
 * The merchant timeline presenter, asserted without a test framework — same convention as
 * verify-bulk-preview.mjs and verify-actions.mjs.
 *
 * The load-bearing assertion is the FIRST one: the label map is a hand-written copy of the
 * backend's tracking vocabulary, and a type that arrives without a merchant-facing label is
 * exactly the drift that ships as a screen reading "ARRIVED_AT_DESTINATION_HUB".
 *
 * Run: node apps/frontends/merchant-web/scripts/verify-timeline.mjs
 */
import { readFileSync } from 'node:fs';
import { eventLabel, timelineLines } from '../src/lib/timeline.ts';

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

const entry = (over = {}) => ({
  eventType: 'PICKED_UP',
  occurredAt: '2026-10-07T16:39:47.960Z',
  actorType: 'rider',
  metadata: {},
  correctsEventId: null,
  ...over,
});

// --- every backend event type has a merchant label; none falls through to the enum ----
const rules = readFileSync(
  new URL('../../../backend/src/modules/tracking/rules/tracking-event.ts', import.meta.url),
  'utf8',
);
const types = [...rules.matchAll(/^  '([A-Z_]+)',$/gm)].map((m) => m[1]);
check('backend declares event types', types.length > 0, true);
for (const type of types) {
  const label = eventLabel(type);
  check(`${type} has a merchant label`, label !== type.toLowerCase().replace(/_/g, ' '), true);
}
// A type this build has never heard of still reads as a sentence, never as raw enum.
check('unknown type is humanised', eventLabel('SOME_FUTURE_EVENT'), 'Some future event');

// --- COD is the row merchants dispute: expected, collected, and the gap --------------
const cod = timelineLines(
  [
    entry({
      eventType: 'COD_COLLECTED',
      metadata: { expectedMinor: 125050, collectedMinor: 125050, shortfallMinor: 0 },
    }),
  ],
  'BDT',
)[0];
check(
  'clean COD shows expected and collected',
  cod.detail,
  'expected ৳1,250.50 · collected ৳1,250.50',
);
check('clean COD does not claim a shortfall', cod.detail.includes('short'), false);

// Over-collection. `shortfallMinor` is expected - collected, so negative means the rider took
// MORE than the quote promised. `reconcile()` calls it a MISMATCH, not a bonus, and says both
// directions must surface — a presenter that only shows a positive gap hides the case where a
// merchant's rider pocketed extra cash.
const over = timelineLines(
  [
    entry({
      eventType: 'COD_COLLECTED',
      metadata: { expectedMinor: 125000, collectedMinor: 130000, shortfallMinor: -5000 },
    }),
  ],
  'BDT',
)[0];
check(
  'over-collection is stated, not hidden',
  over.detail,
  'expected ৳1,250.00 · collected ৳1,300.00 · ৳50.00 over-collected',
);
check('over-collection does not claim a shortfall', over.detail.includes('short'), false);
// The live row from the seeded DB is exactly this shape: 125000 / 130000 / -5000.
check('the over-collected amount is exact', over.detail.includes('৳50.00'), true);

const short = timelineLines(
  [
    entry({
      eventType: 'COD_COLLECTED',
      metadata: { expectedMinor: 125050, collectedMinor: 100000, shortfallMinor: 25050 },
    }),
  ],
  'BDT',
)[0];
check(
  'short COD shows the gap',
  short.detail,
  'expected ৳1,250.50 · collected ৳1,000.00 · ৳250.50 short',
);

// Money is rendered from integer minor units. A float here is rule 4 broken.
check('minor units are exact to the poisha', short.detail.includes('৳250.50'), true);

// --- hub scans name the hub, so "where is my parcel" is answerable -------------------
const scan = timelineLines(
  [entry({ eventType: 'ARRIVED_AT_HUB', metadata: { scan: 'inbound', hubCode: 'DHK-01' } })],
  'BDT',
)[0];
check('hub scan names the hub', scan.detail, 'hub DHK-01 · inbound');

// --- hold and release read as a pause, not as enum noise -----------------------------
const held = timelineLines(
  [
    entry({
      eventType: 'SHIPMENT_HELD',
      metadata: { reason: 'Customer requested a later pickup', resumeFrom: 'OUT_FOR_DELIVERY' },
    }),
  ],
  'BDT',
)[0];
check(
  'hold shows the reason and where it paused',
  held.detail,
  'Customer requested a later pickup · paused from Out for delivery',
);
const released = timelineLines(
  [entry({ eventType: 'SHIPMENT_RELEASED', metadata: { resumedTo: 'OUT_FOR_DELIVERY' } })],
  'BDT',
)[0];
check('release shows where it resumed', released.detail, 'resumed to Out for delivery');

// --- a note is not repeated when it is the reason ------------------------------------
const noted = timelineLines(
  [
    entry({
      eventType: 'EXCEPTION_RAISED',
      metadata: { reason: 'DAMAGED', note: 'Box is crushed' },
    }),
  ],
  'BDT',
)[0];
check('reason and note both shown when they differ', noted.detail, 'DAMAGED · Box is crushed');
const sameNote = timelineLines(
  [entry({ eventType: 'EXCEPTION_RAISED', metadata: { reason: 'DAMAGED', note: 'DAMAGED' } })],
  'BDT',
)[0];
check('note not duplicated when it repeats the reason', sameNote.detail, 'DAMAGED');

// --- an unrecognised metadata bag must not crash or print [object Object] ------------
const messy = timelineLines(
  [
    entry({
      eventType: 'DELIVERED',
      metadata: {
        nested: { deep: { worse: true } },
        list: [1, 2, 3],
        empty: '',
        blank: '   ',
        nan: Number.NaN,
        infinity: Number.POSITIVE_INFINITY,
        nullish: null,
        count: 3,
      },
    }),
  ],
  'BDT',
)[0];
check('objects and arrays dropped', /object|\d,\d/.test(messy.detail), false);
check('empty and whitespace strings dropped', messy.detail.includes('empty'), false);
check('NaN and Infinity dropped', /NaN|Infinity/.test(messy.detail), false);
// An unread key is dropped, not rendered. jobId is in the bag on a real delivery attempt
// and a merchant has no use for it; printing the whole bag is how a log view becomes noise.
check('unrecognised scalars dropped too', messy.detail, '');
const noisy = timelineLines(
  [
    entry({
      eventType: 'DELIVERY_ATTEMPTED',
      metadata: { jobId: 'j-1', pickupId: 'p-1', sequence: 1 },
    }),
  ],
  'BDT',
)[0];
check('ids are not rendered, the attempt number is', noisy.detail, 'attempt 1');

// --- an event with no metadata at all still renders ----------------------------------
const bare = timelineLines([entry({ eventType: 'DELIVERED' })], 'BDT')[0];
check('bare event has a label', bare.label, 'Delivered');
check('bare event has empty detail', bare.detail, '');
check('bare event still renders a line', typeof bare.occurredAt, 'string');

// --- a correction is its own line, never a replacement (rule 8) -----------------------
const corrected = timelineLines(
  [
    entry({ eventType: 'ARRIVED_AT_HUB', occurredAt: '2026-10-07T10:00:00.000Z' }),
    entry({
      eventType: 'EVENT_CORRECTED',
      occurredAt: '2026-10-07T11:00:00.000Z',
      correctsEventId: 'e1',
    }),
  ],
  'BDT',
);
check('the corrected row is still shown', corrected.length, 2);
check('the correction is flagged', corrected[1].corrects, true);
check('the original is not flagged', corrected[0].corrects, false);
// A correction that names no row is still a correction. reconcile-cod.service.ts writes
// EVENT_CORRECTED with corrects_event_id null, so keying the badge on the id alone would
// leave the one correction a merchant disputes over looking like an ordinary event.
const untargeted = timelineLines(
  [entry({ eventType: 'EVENT_CORRECTED', correctsEventId: null })],
  'BDT',
)[0];
check('a correction with no target is still flagged', untargeted.corrects, true);
// And an ordinary event that happens to reference a row is still a correction.
check(
  'a non-correction that references nothing is not flagged',
  timelineLines([entry()], 'BDT')[0].corrects,
  false,
);
check('the correction reads as a correction', corrected[1].label, 'Earlier entry corrected');

// --- keys must be unique even when two rows share an instant -------------------------
// React drops a duplicate key, and then the timeline silently renders one row short.
const sameInstant = timelineLines(
  [
    entry({ eventType: 'DELIVERY_ATTEMPTED', occurredAt: '2026-10-07T10:00:00.000Z' }),
    entry({ eventType: 'DELIVERY_ATTEMPTED', occurredAt: '2026-10-07T10:00:00.000Z' }),
  ],
  'BDT',
);
check('identical rows get distinct keys', sameInstant[0].key !== sameInstant[1].key, true);
check('both rows kept', sameInstant.length, 2);

// --- the attempt number, which is what "it failed twice" means ------------------------
const attempt = timelineLines(
  [entry({ eventType: 'DELIVERY_ATTEMPTED', metadata: { sequence: 2, retryScheduled: true } })],
  'BDT',
)[0];
check('attempt number and retry shown', attempt.detail, 'attempt 2 · retry scheduled');

// --- an empty log is empty, not a crash -----------------------------------------------
check('empty log yields no lines', timelineLines([], 'BDT'), []);
check('actor type is carried through', timelineLines([entry()], 'BDT')[0].actorType, 'rider');

console.log(failures === 0 ? '\ntimeline presenter ok' : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
