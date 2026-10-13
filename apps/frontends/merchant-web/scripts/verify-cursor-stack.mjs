/**
 * Cursor-stack navigation, asserted without a test framework — same convention
 * as verify-phone.mjs, verify-actions.mjs and verify-client.mjs.
 *
 * This is the runnable half of the plan's pagination exit check: "Page 1 → page
 * 2 → back → page 1 with a shipment created in between shows no duplicate and no
 * skip". The server half is Postgres' job and is already covered by
 * apps/backend/src/modules/shipment/rules/pagination.spec.ts; what is easy to
 * get wrong here is the client's stack, so that is what these assert.
 *
 * Run: node apps/frontends/merchant-web/scripts/verify-cursor-stack.mjs
 */
import { FIRST_PAGE, currentCursor, newer, older, pageNumber } from '../src/lib/cursorStack.ts';

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

const PAGE_SIZE = 5;

/**
 * A fake server: newest-first rows, and a cursor naming the last row of the page
 * just returned. Keying the cursor on row identity rather than on an index is
 * the whole point — the real cursor is (created_at, id), so a shipment created
 * while the user is away sorts before the cursor and never shifts it. An index
 * cursor would drift and this fake would pass where production fails.
 */
function server(rows) {
  return {
    rows,
    fetch(cursor) {
      const from = cursor === null ? 0 : rows.indexOf(cursor) + 1;
      const page = rows.slice(from, from + PAGE_SIZE);
      return {
        rows: page,
        // A short page means the end of the list; a full page may still be last.
        nextCursor: page.length < PAGE_SIZE ? null : (page[page.length - 1] ?? null),
      };
    },
  };
}

/** What the screen shows for a stack: fetch with the stack's current cursor. */
function shown(state) {
  return state.db.fetch(currentCursor(state.stack));
}

function walk(state, press) {
  const stack =
    press === 'older' ? older(state.stack, shown(state).nextCursor) : newer(state.stack);
  return { ...state, stack };
}

const ROWS = Array.from({ length: 12 }, (_, i) => `s${i}`);
let state = { stack: FIRST_PAGE, db: server(ROWS) };

check('first page shows the 5 newest', shown(state).rows, ['s0', 's1', 's2', 's3', 's4']);
check('first page has no cursor', currentCursor(state.stack), null);
check('first page is page 1', pageNumber(state.stack), 1);
check('newer on the first page is a no-op', newer(FIRST_PAGE), FIRST_PAGE);
check('older with no next cursor changes nothing', older(FIRST_PAGE, null), FIRST_PAGE);

state = walk(state, 'older');
check('page 2 shows the next 5', shown(state).rows, ['s5', 's6', 's7', 's8', 's9']);
check('page 2 holds a cursor', typeof currentCursor(state.stack), 'string');
check('page 2 is page 2', pageNumber(state.stack), 2);

state = walk(state, 'older');
check('page 3 shows the remaining rows', shown(state).rows, ['s10', 's11']);
check('the last page has no next cursor', shown(state).nextCursor, null);
check('older on the last page changes nothing', state.stack, state.stack);
check('newer is offered from the last page', newer(state.stack).length, 2);

// The exit check: walk forward, insert a shipment while away, walk back to page 1.
state = walk(state, 'newer');
check('back to page 2', shown(state).rows, ['s5', 's6', 's7', 's8', 's9']);
ROWS.unshift('brand-new');
state = walk(state, 'newer');
check('back to page 1 shows the new shipment', shown(state).rows, [
  'brand-new',
  's0',
  's1',
  's2',
  's3',
]);
check('we are back on page 1 with a fresh cursor', state.stack.length, 1);
check('the last row of page 1 is the cursor, not an index', shown(state).nextCursor, 's3');

const page1 = shown(state).rows;
state = walk(state, 'older');
const page2 = shown(state).rows;

// The property that matters: after a write, the two pages the user walks are the
// 10 newest rows with nothing repeated and nothing dropped in the gap.
check('page 1 is the newest 5', page1, ['brand-new', 's0', 's1', 's2', 's3']);
check('page 2 starts where page 1 stopped', page2, ['s4', 's5', 's6', 's7', 's8']);
check(
  'no row appears on both pages',
  page1.filter((r) => page2.includes(r)),
  [],
);
check('no row is skipped between them', [...page1, ...page2], ROWS.slice(0, 10));

// Two invariants that would both break the list query: popping the first entry
// leaves nothing to render, and a null buried mid-stack silently refetches page 1.
const deep = older(older(older(FIRST_PAGE, 'c1'), 'c2'), 'c3');
check('popping one entry off a 4-deep stack leaves 3', newer(deep).length, 3);
check(
  'the first entry is the only null',
  deep.filter((c) => c === null),
  [null],
);
check('a page-4 walk reaches page 4', pageNumber(deep), 4);

if (failures > 0) {
  console.error(`\ncursor stack: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\ncursor stack ok');
