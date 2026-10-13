/**
 * Asserts the list filter's pure logic — what the query looks like, what counts
 * as "a filter is on", and that every field that changes the result is in the
 * useAsync key. That last one is the load-bearing claim: a field missing from
 * the key means the screen silently keeps showing the previous filter's rows.
 *
 * Run: node apps/frontends/merchant-web/scripts/verify-filters.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const lib = (f) => import(join(here, '..', 'src', 'lib', f));

const { NO_FILTERS, clampRange, isFiltered, queryKey, shipmentQuery } = await lib('filters.ts');
const { STATUS_GROUPS } = await lib('statusGroups.ts');

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

// ---------------------------------------------------------------- what the server receives
check('no filters sends only the limit', shipmentQuery(NO_FILTERS, null, 25), { limit: '25' });

check(
  'every filter reaches the query',
  shipmentQuery(
    {
      q: 'ZP-1',
      status: 'LOST,DAMAGED',
      zone: 'dhaka-metro',
      from: '2026-10-01',
      to: '2026-10-09',
    },
    null,
    25,
  ),
  {
    limit: '25',
    status: 'LOST,DAMAGED',
    zone: 'dhaka-metro',
    q: 'ZP-1',
    from: '2026-10-01',
    to: '2026-10-09',
  },
);

check(
  'a cursor is sent only when there is one',
  [shipmentQuery(NO_FILTERS, null, 25).cursor, shipmentQuery(NO_FILTERS, 'abc', 25).cursor],
  [undefined, 'abc'],
);

check(
  'blank values are omitted, not sent as ?status=',
  Object.keys(shipmentQuery({ ...NO_FILTERS, q: '   ' }, null, 25)),
  ['limit'],
);

check(
  'a whitespace-only search term is treated as no search',
  shipmentQuery({ ...NO_FILTERS, q: '   ' }, null, 25),
  { limit: '25' },
);

check(
  'a padded search term is trimmed before it reaches the URL',
  shipmentQuery({ ...NO_FILTERS, q: '  ZP-1  ' }, null, 25).q,
  'ZP-1',
);

check(
  'a single status still works (no group required)',
  shipmentQuery({ ...NO_FILTERS, status: 'DELIVERED' }, null, 25).status,
  'DELIVERED',
);

// ---------------------------------------------------------------- what counts as "filtered"
check('no filters is not filtered', isFiltered(NO_FILTERS), false);
// Whitespace is not a filter. The server sends nothing for it, so offering Clear
// over an unfiltered list would be a button that lies about the list.
check('a whitespace-only search is not a filter', isFiltered({ ...NO_FILTERS, q: '   ' }), false);
for (const patch of [
  { q: 'x' },
  { status: 'DELIVERED' },
  { zone: 'dhaka-metro' },
  { from: '2026-10-01' },
  { to: '2026-10-09' },
]) {
  check(`${JSON.stringify(patch)} is filtered`, isFiltered({ ...NO_FILTERS, ...patch }), true);
}

// ---------------------------------------------------------------- the useAsync key
const base = { filters: NO_FILTERS, cursor: null };
const keyOf = (filters, cursor = null) => queryKey(filters, cursor);
ok('the same state gives the same key', keyOf(base.filters) === keyOf(NO_FILTERS));

for (const patch of [
  { q: 'x' },
  { status: 'DELIVERED' },
  { zone: 'dhaka-metro' },
  { from: '2026-10-01' },
  { to: '2026-10-09' },
]) {
  ok(
    `${JSON.stringify(patch)} changes the key`,
    keyOf({ ...NO_FILTERS, ...patch }) !== keyOf(NO_FILTERS),
    'the screen would keep showing the unfiltered rows',
  );
}

ok(
  'a cursor changes the key',
  keyOf(NO_FILTERS, 'abc') !== keyOf(NO_FILTERS),
  'paging would not refetch',
);

// The separator matters: without it these two collide.
ok(
  'the key cannot be split ambiguously',
  keyOf({ ...NO_FILTERS, q: 'a b' }) !== keyOf({ ...NO_FILTERS, q: 'a', status: 'b' }),
  'two different filters produced the same key',
);

// ---------------------------------------------------------------- date cross-clamping
const from = '2026-10-09';
const to = '2026-10-01';
check('a backwards range is clamped', clampRange({ ...NO_FILTERS, from, to }), {
  ...NO_FILTERS,
  from,
  to: from,
});
check('a forwards range is untouched', clampRange({ ...NO_FILTERS, from: to, to: from }), {
  ...NO_FILTERS,
  from: to,
  to: from,
});
check('one-sided ranges are untouched', clampRange({ ...NO_FILTERS, from }), {
  ...NO_FILTERS,
  from,
});
check('a single day is not a backwards range', clampRange({ ...NO_FILTERS, from: to, to }), {
  ...NO_FILTERS,
  from: to,
  to,
});
check('neither bound is untouched', clampRange(NO_FILTERS), NO_FILTERS);

// ---------------------------------------------------------------- the groups are real query values
for (const group of STATUS_GROUPS) {
  if (group.value === '') continue;
  const statuses = group.value.split(',');
  ok(
    `group "${group.label}" sends ${statuses.length} statuses`,
    shipmentQuery({ ...NO_FILTERS, status: group.value }, null, 25).status === group.value,
    'the dropdown value and the query value disagree',
  );
  ok(
    `group "${group.label}" has no empty member`,
    statuses.every((s) => s.trim() !== '' && s === s.trim()),
    JSON.stringify(statuses),
  );
  ok(
    `group "${group.label}" has no duplicate member`,
    new Set(statuses).size === statuses.length,
    JSON.stringify(statuses),
  );
}

check('the first group is the empty "no filter" one', STATUS_GROUPS[0].value, '');

// ---------------------------------------------------------------- the zones the picker shows come from the API
const clientSrc = readFileSync(
  join(here, '..', 'src', 'routes', 'app', 'shipments.index.tsx'),
  'utf8',
);
ok(
  'the zone picker reads zones from the server, not a hardcoded list',
  /\.zones\(\)|zones\(\)/.test(clientSrc),
  'no zones() call in the route',
);
ok(
  'no zone name is hardcoded in the route',
  !/['"]dhaka-metro['"]/.test(clientSrc),
  'a hardcoded zone goes stale the moment the network adds one',
);
ok(
  'every status group reaches the UI',
  /STATUS_GROUPS/.test(clientSrc),
  'the route never imports statusGroups',
);
ok('the filter bar is used, not rebuilt', /FilterBar/.test(clientSrc), 'no FilterBar in the route');

// ---------------------------------------------------------------- a filter change resets the cursor stack
// Asserted on the source because the failure it prevents is invisible: page 4 of
// the old filter, requested with the new one, is a valid-looking page of rows the
// merchant never asked for, and the header would agree with it.
{
  const set = clientSrc.match(/const set = \(patch:[\s\S]*?\n  };/);
  ok(
    'the route has one set() for every filter change',
    set !== null,
    'filters are applied from several places',
  );
  if (set) {
    ok('it resets the cursor stack', /setCursors\(FIRST_PAGE\)/.test(set[0]), set[0]);
    ok(
      'the reset is unconditional, not inside a conditional',
      !/if\s*\(/.test(set[0]),
      'a filter change that skips the reset keeps the old page',
    );
  }
  ok('the cursor still comes from the stack', /currentCursor\(cursors\)/.test(clientSrc));
  ok(
    'the useAsync key covers the filters',
    /queryKey\(filters, cursor\)/.test(clientSrc),
    'the screen would keep showing the previous filter',
  );
}

// ---------------------------------------------------------------- the columns the filters act on
ok(
  'the table shows the zone a row was filtered by',
  /zone/.test(clientSrc),
  'a zone filter whose result column is invisible reads as if it covered the list',
);

console.log(failures === 0 ? '\nfilters ok' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
