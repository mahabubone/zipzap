/**
 * Asserts the bulk-import checkpoint's pure logic: which rows reach the screen,
 * what counts as finished, and that the template we hand a merchant describes
 * a file the backend can actually read.
 *
 * That last one is the point: a template the server rejects is worse than no
 * template, because the merchant trusts it. The column list is cross-checked
 * against the backend's own BULK_COLUMNS.
 *
 * Run: node apps/frontends/merchant-web/scripts/verify-bulk-preview.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const lib = (f) => import(join(here, '..', 'src', 'lib', f));

const {
  TEMPLATE_HEADER,
  TEMPLATE_ROW,
  isProblem,
  isTerminal,
  jobHeadline,
  jobSucceeded,
  progressPercent,
  reasonsByFrequency,
  summarisePreview,
  templateCsv,
} = await lib('bulk.ts');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`,
  );
}
function ok(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        ${detail}`}`);
}

const row = (n, outcome, reason = null) => ({
  lineNumber: n,
  invoice: `INV-${n}`,
  outcome,
  reason,
});
const job = (over = {}) => ({
  id: 'j1',
  merchantId: 'm1',
  filename: 'orders.csv',
  status: 'PREVIEW',
  totalRows: 0,
  processedRows: 0,
  succeededRows: 0,
  failedRows: 0,
  skippedRows: 0,
  ...over,
});

/** A file of `n` ready rows, with `problems` failures at the end. */
function file(n, problems = 0) {
  return [
    ...Array.from({ length: n - problems }, (_, i) => row(i + 2, 'READY')),
    ...Array.from({ length: problems }, (_, i) => row(n + i + 1, 'FAILED', `reason ${i}`)),
  ];
}

// ---------------------------------------------------------------- which rows show
check('a clean file is clean', summarisePreview(file(10)).clean, true);
check('a clean file has no problems', summarisePreview(file(10)).problems, 0);
check('a file with a failure is not clean', summarisePreview(file(10, 1)).clean, false);

check('a small file shows every row', summarisePreview(file(10)).shown.length, 10);
check('a small file hides nothing', summarisePreview(file(10)).hiddenReady, 0);

{
  // The load-bearing case: 10,000 good rows must not become 10,000 <tr>s.
  const big = summarisePreview(file(10_000));
  check('a 10,000-row file is capped', big.shown.length, 50);
  check('and the cap is reported, not silently applied', big.hiddenReady, 10_000 - 50);
  check('the true total is still shown', big.total, 10_000);
  check('the ready count is still exact', big.ready, 10_000);
}

{
  // A merchant who scrolls past a failure because the file had good rows above
  // it has been told the wrong thing, so problems come first and in full — the
  // cap applies to the READY rows, never to the failures.
  const one = summarisePreview([...file(500), row(600, 'FAILED', 'bad phone')]);
  check('a single failure still fits under the cap', one.shown.length, 50);
  ok('and it is a row that is shown', one.shown.some((r) => r.outcome === 'FAILED'));
  check('problems are shown first', one.shown[0].outcome, 'FAILED');
  check('the omitted rows are counted as ready, not as failures', one.hiddenReady, 500 - 49);

  const many = summarisePreview(file(500, 60));
  check('the table grows past the cap rather than dropping failures', many.shown.length, 60);
  check('every failure is present', many.shown.filter((r) => r.outcome === 'FAILED').length, 60);
  check('and no ready row crowds them out', many.shown.filter((r) => r.outcome !== 'FAILED').length, 0);
  check('the counts are still exact', [many.total, many.ready, many.problems], [500, 440, 60]);
}

check('an empty preview is empty, not an error', summarisePreview([]).total, 0);
ok('an empty preview is trivially clean', summarisePreview([]).clean === true);

// ---------------------------------------------------------------- isProblem
check('FAILED is a problem', isProblem(row(2, 'FAILED', 'x')), true);
check('READY is not', isProblem(row(2, 'READY')), false);
check('CREATED is not a problem — it is a result', isProblem(row(2, 'CREATED')), false);
check(
  'SKIPPED_DUPLICATE is not a problem — the parcel already exists',
  isProblem(row(2, 'SKIPPED_DUPLICATE', 'shipment already exists')),
  false,
);

// ---------------------------------------------------------------- reasons
check(
  'reasons are grouped most frequent first',
  reasonsByFrequency([
    row(2, 'FAILED', 'bad phone'),
    row(3, 'FAILED', 'missing name'),
    row(4, 'FAILED', 'bad phone'),
  ]).map((r) => [r.reason, r.count]),
  [
    ['bad phone', 2],
    ['missing name', 1],
  ],
);
check('a ready row contributes no reason', reasonsByFrequency(file(5)).length, 0);
check(
  'ties break alphabetically, so the list is stable between renders',
  reasonsByFrequency([row(2, 'FAILED', 'b'), row(3, 'FAILED', 'a')]).map((r) => r.reason),
  ['a', 'b'],
);

// ---------------------------------------------------------------- terminal states
check('PROCESSING is not terminal', isTerminal(job({ status: 'PROCESSING' })), false);
check('PREVIEW is not terminal', isTerminal(job({ status: 'PREVIEW' })), false);
for (const status of ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED']) {
  check(`${status} is terminal`, isTerminal(job({ status })), true);
}
check(
  'an unrecognised status is NOT terminal',
  isTerminal(job({ status: 'SOMETHING_NEW' })),
  false,
  'silently treating an unknown status as running is how a poll loop never ends',
);

// ---------------------------------------------------------------- success
check('COMPLETED is a success', jobSucceeded(job({ status: 'COMPLETED' })), true);
check(
  'COMPLETED_WITH_ERRORS is a success, not a failure',
  jobSucceeded(job({ status: 'COMPLETED_WITH_ERRORS' })),
  true,
);
check('FAILED is not a success', jobSucceeded(job({ status: 'FAILED' })), false);
check('PROCESSING is not a success', jobSucceeded(job({ status: 'PROCESSING' })), false);

// ---------------------------------------------------------------- progress
check('nothing processed is 0%', progressPercent(job({ totalRows: 10, processedRows: 0 })), 0);
check('half done is 50%', progressPercent(job({ totalRows: 10, processedRows: 5 })), 50);
check('all done is 100%', progressPercent(job({ totalRows: 10, processedRows: 10 })), 100);
check('an empty job is 100%, not NaN', progressPercent(job({ totalRows: 0 })), 100);
check(
  'a replay that over-counts is clamped to 100%',
  progressPercent(job({ totalRows: 10, processedRows: 12 })),
  100,
);

// ---------------------------------------------------------------- headline
ok(
  'COMPLETED_WITH_ERRORS reads as finished, not broken',
  /Finished/.test(
    jobHeadline(job({ status: 'COMPLETED_WITH_ERRORS', succeededRows: 9997, failedRows: 3 })),
  ),
  jobHeadline(job({ status: 'COMPLETED_WITH_ERRORS' })),
);
ok(
  'PROCESSING says what it is doing and how far along',
  /5 of 10/.test(jobHeadline(job({ status: 'PROCESSING', processedRows: 5, totalRows: 10 }))),
  jobHeadline(job({ status: 'PROCESSING' })),
);
check(
  'an unknown status does not claim to be running',
  jobHeadline(job({ status: 'NOPE' })),
  'Unknown status',
);

// ---------------------------------------------------------------- the template
// The load-bearing check: the template must match the backend's own columns.
{
  const backend = readFileSync(
    join(here, '..', '..', '..', 'backend', 'src', 'modules', 'shipment', 'rules', 'bulk.ts'),
    'utf8',
  );
  const declared = backend
    .slice(backend.indexOf('export const BULK_COLUMNS'))
    .slice(0, backend.indexOf('] as const'))
    .match(/'([a-z_]+)'/g)
    .map((s) => s.replaceAll("'", ''));
  check('the backend still declares nine columns', declared.length, 9);

  // NOT "identical": the backend also accepts `delivery_note`, which the
  // processor never reads. Advertising a column that is accepted and silently
  // discarded is worse than omitting it — the merchant fills it in and believes
  // it did something. The template lists what actually lands.
  const offered = TEMPLATE_HEADER.split(',');
  ok(
    'every column the template offers is one the backend reads',
    offered.every((c) => declared.includes(c)),
    offered.filter((c) => !declared.includes(c)).join(', '),
  );
  check(
    'and it is a prefix of the backend order, so the two cannot drift apart silently',
    declared.slice(0, offered.length),
    offered,
  );

  const { mapHeader } = await import(
    join(here, '..', '..', '..', 'backend', 'src', 'modules', 'shipment', 'rules', 'bulk.ts')
  );
  check(
    'every column the backend REQUIRES is offered',
    mapHeader(TEMPLATE_HEADER.split(',')).missing,
    [],
  );
}

{
  // The example row must itself survive the backend's validator, or the template
  // ships a file guaranteed to fail. Parsed with the BACKEND's parser, not
  // `split(',')` — the naive split is the exact mistake this assertion exists to
  // catch, and using it here made the test blame the template for its own bug.
  const { parseCsv, mapHeader, validateRow, BULK_COLUMNS } = await import(
    join(here, '..', '..', '..', 'backend', 'src', 'modules', 'shipment', 'rules', 'bulk.ts')
  );
  const grid = parseCsv(templateCsv());
  check('the template parses to two rows', grid.length, 2);

  const { index, missing } = mapHeader(grid[0]);
  check('the template header satisfies the backend\'s required columns', missing, []);

  const fields = {};
  for (const column of BULK_COLUMNS) {
    const at = index[column];
    fields[column] = at === undefined ? '' : (grid[1][at] ?? '');
  }
  check('the example row is what the backend would accept', validateRow(fields).kind, 'READY');
  check(
    'and the quoted address survived as one cell',
    fields.recipient_address,
    'Agrabad C/A, Chattogram',
  );
  check('the example phone is E.164, the format the regex requires', fields.recipient_phone, '+8801810000001');
  check('the example COD is integer minor units, not a decimal', fields.cod_amount, '125050');
  check('the example weight is integer grams', fields.parcel_weight, '1200');
}

ok('the template ends with a newline', templateCsv().endsWith('\n'));
check('the template is header + one example row', templateCsv().trim().split('\n').length, 2);
ok(
  'the example address is quoted, because it contains a comma',
  TEMPLATE_ROW.includes('"Agrabad C/A, Chattogram"'),
);
// ---------------------------------------------------------------- the screen
const screen = readFileSync(join(here, '..', 'src', 'routes', 'app', 'shipments.bulk.tsx'), 'utf8');
ok('the screen uses the summary rather than mapping every row', /summarisePreview/.test(screen));
ok('the screen stops polling on a terminal status', /isTerminal/.test(screen));
ok('the screen offers the result download', /bulkResultCsv/.test(screen));
ok('Accept is not offered before the preview', /status === 'PREVIEW'/.test(screen));
ok(
  'the screen re-reads the file rather than pretending a re-upload resumes',
  /uploadBulk/.test(screen),
);

console.log(failures === 0 ? '\nbulk preview ok' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
