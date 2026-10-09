/**
 * The map's geometry and its tile-failure policy, asserted without a test framework.
 *
 * The frontend convention in this repo is a zero-dependency `verify-*.mjs` script (see
 * merchant-web/scripts/verify-money.mjs), and these two files are where exit check four actually
 * lives: "the map degrades to a list when the tile server is unreachable" is a decision about tile
 * outcomes, and a decision that can be wrong in six ways deserves to be checked in six ways.
 *
 * Run: node apps/frontends/control-tower/scripts/verify-map.mjs
 */
import { BOUNDS, isInBounds, markerSize, project } from '../src/lib/map-projection.ts';
import {
  FALLBACK_THRESHOLD,
  tileUrl,
  tilesHaveFailed,
  tilesPending,
} from '../src/lib/tiles.ts';

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

const W = 800;
const H = 600;

// --- projection. The order of these is load-bearing: north is up, and each corner is exact.
check('Dhaka sits west of Chattogram, left to right', project(23.81, 90.41, W, H).x < project(22.36, 91.83, W, H).x, true);
check('and north of it, higher on screen', project(23.81, 90.41, W, H).y < project(22.36, 91.83, W, H).y, true);
check('the west edge is the left edge', project(23.81, BOUNDS.west, W, H).x, 0);
check('the east edge is the right edge', project(23.81, BOUNDS.east, W, H).x, W);
check('the north edge is the TOP edge — screen y grows down, latitude grows up', project(BOUNDS.north, 90.4, W, H).y, 0);
check('the south edge is the bottom edge', project(BOUNDS.south, 90.4, W, H).y, H);
check(
  'the middle of the box is the middle of the frame',
  (({ x, y }) => ({ x: Math.round(x), y: Math.round(y) }))(
    project((BOUNDS.north + BOUNDS.south) / 2, (BOUNDS.west + BOUNDS.east) / 2, W, H),
  ),
  { x: W / 2, y: H / 2 },
);
check('Sylhet is inside the frame, not off it', project(24.8949, 91.8687, W, H).x > 0 && project(24.8949, 91.8687, W, H).x < W, true);

// A phone with no fix reports (0, 0) — the Gulf of Guinea. Clamping that to the nearest edge would
// draw a confident dot on the border of Bangladesh, so out-of-bounds is DROPPED, not nudged.
check('Null Island is out of bounds and is not drawn', isInBounds(0, 0), false);
check('Sydney is out of bounds too', isInBounds(-33.8688, 151.2093), false);
check('Dhaka is in bounds', isInBounds(23.81, 90.41), true);
check('Sylhet, the far corner of the network, is in bounds', isInBounds(24.8949, 91.8687), true);
check('Cox`s Bazar coast is inside the box', isInBounds(21.4272, 92.0058), true);
check('NaN is never in bounds', isInBounds(Number.NaN, 90.4), false);
check('Infinity is never in bounds', isInBounds(23.8, Number.POSITIVE_INFINITY), false);

// Hubs grow with their load; riders are a fixed dot.
check('an empty hub is a small square', markerSize(0), 10);
check('a busy hub is bigger', markerSize(20) > markerSize(2), true);
check('but not unbounded', markerSize(10000), 22);
check('a rider is a constant dot, because it has no load to show', markerSize(null), 10);

// --- the tile URL template, which is the only thing that can silently produce 404s
const template = 'https://tile.example/{z}/{x}/{y}.png';
check('the template substitutes all three placeholders', tileUrl(template, 7, 121, 84), 'https://tile.example/7/121/84.png');
check('a template with no placeholders is passed through unchanged', tileUrl('https://x/y.png', 1, 2, 3), 'https://x/y.png');

// --- the fallback policy. This is exit check four.
check('no verdict on a cold load — the map must not flash a list while tiles arrive', tilesHaveFailed([]), false);
check('nor on a partial load, where some tiles are still in flight', tilesHaveFailed([{ url: 'a', verdict: 'failed' }]), false);

// One dead tile out of nine is a blip, not an outage. Falling back here would be absurd.
check('one failed tile of nine is not an outage', tilesHaveFailed([{ url: 'a', verdict: 'ok' }, { url: 'b', verdict: 'failed' }, ...Array.from({ length: 7 }, (_, i) => ({ url: `c${i}`, verdict: 'ok' }))]), false);

// Half or more is. This is the CDN being down.
check('nine of nine failed IS an outage', tilesHaveFailed(Array.from({ length: 9 }, (_, i) => ({ url: `t${i}`, verdict: 'failed' }))), true);
check('five of ten failed is an outage — exactly at the threshold', tilesHaveFailed([...Array.from({ length: 5 }, (_, i) => ({ url: `f${i}`, verdict: 'failed' })), ...Array.from({ length: 5 }, (_, i) => ({ url: `o${i}`, verdict: 'ok' }))]), true);
check('four of ten is not — under the threshold', tilesHaveFailed([...Array.from({ length: 4 }, (_, i) => ({ url: `f${i}`, verdict: 'failed' })), ...Array.from({ length: 6 }, (_, i) => ({ url: `o${i}`, verdict: 'ok' }))]), false);
check('the threshold is half', FALLBACK_THRESHOLD, 0.5);

// Pending is tracked separately, so "every tile failed" is distinguishable from "no tile answered yet".
check('nine of nine arrived is not pending', tilesPending(Array.from({ length: 9 }, (_, i) => ({ url: `t${i}`, verdict: 'ok' })), 9), false);
check('eight of nine is still pending', tilesPending(Array.from({ length: 8 }, (_, i) => ({ url: `t${i}`, verdict: 'ok' })), 9), true);

// A failed tile is still an outcome — counting only successes would hide the outage entirely.
check('a failed tile counts toward "arrived" for the pending test', tilesPending([{ url: 'a', verdict: 'failed' }], 1), false);

console.log(failures === 0 ? '\nmap projection and tile policy ok' : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);