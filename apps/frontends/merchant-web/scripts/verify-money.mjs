/**
 * Amount parsing, asserted without a test framework — same convention as verify-timeline.mjs.
 *
 * The load-bearing assertions are the float ones at the bottom: they are the exact inputs on
 * which `Math.round(Number(x) * 100)` rounded DOWN while `Math.round(Number(y) * 100)` rounded UP
 * for the same reason. If someone "simplifies" this back to that expression, these fail.
 *
 * The formatter it imports moved to `@zipzap/web-kit` when four copies of it became one; the
 * sweep stayed here because 200,000 cases is too slow for a unit-test run and this script is the
 * thing `pnpm prove` executes.
 *
 * Run: node apps/frontends/merchant-web/scripts/verify-money.mjs
 */
import { parseAmount, parseAmountMinor } from '../src/lib/money.ts';
import { formatMinor } from '@zipzap/web-kit';

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

// --- the ordinary cases ------------------------------------------------------
check('a whole amount', parseAmountMinor('1250'), 125000);
check('two decimals', parseAmountMinor('1250.55'), 125055);
check('one decimal', parseAmountMinor('1250.5'), 125050);
check('zero', parseAmountMinor('0'), 0);
check('empty means no COD, not an error', parseAmountMinor(''), 0);
check('whitespace only means no COD', parseAmountMinor('   '), 0);
check('a trailing point is tolerated', parseAmountMinor('12.'), 1200);
check('a leading point is tolerated', parseAmountMinor('.50'), 50);
check('one poisha', parseAmountMinor('0.01'), 1);
check('a leading zero is not octal', parseAmountMinor('01250.55'), 125055);

// --- separators a merchant pastes in from an invoice ------------------------
check('thousands separators', parseAmountMinor('1,250.55'), 125055);
check('spaces as separators', parseAmountMinor('1 250.55'), 125055);
check('a non-breaking space', parseAmountMinor('1 250.55'), 125055);

// --- the float trap ---------------------------------------------------------
// 1.005 is stored as 1.00499999999999989 and 8.115 as 8.115000000000000213. The old
// expression rounded the first DOWN and the second UP — the direction came from the binary
// representation, not from what the merchant typed.
check('1.005 is refused, not silently rounded', parseAmount('1.005').minor, null);
check(
  'and says why',
  parseAmount('1.005').error,
  'Use at most 2 decimal places — the poisha is the smallest unit',
);
check('8.115 is refused too, for the same reason', parseAmount('8.115').minor, null);
check('2.675 is refused', parseAmount('2.675').minor, null);
check('the refusal is consistent, not dependent on the digits', parseAmount('0.145').minor, null);
// A third decimal is a typo to show, not a number to round. Assert the direction the old
// code would have taken, so the regression cannot come back unnoticed.
check('the old expression rounded 1.005 DOWN', Math.round(Number('1.005') * 100), 100);
check('the old expression rounded 8.115 UP', Math.round(Number('8.115') * 100), 812);
check(
  'so the old expression was inconsistent on identical input shapes',
  Math.round(Number('1.005') * 100) === Math.round(Number('8.115') * 100),
  false,
);

// --- the poisha is exact for every two-decimal amount -----------------------
// Swept rather than sampled: 200,000 whole amounts x 12 cent values, all exact integers.
let exact = true;
let firstBad = null;
for (let major = 0; major <= 200000 && exact; major++) {
  for (const cents of ['00', '01', '05', '10', '15', '29', '30', '33', '55', '57', '75', '99']) {
    const typed = `${major}.${cents}`;
    const expected = major * 100 + Number(cents);
    const got = parseAmountMinor(typed);
    if (got !== expected || !Number.isSafeInteger(got)) {
      exact = false;
      firstBad = { typed, expected, got };
      break;
    }
  }
}
check('every 2dp amount under ৳200,000 is exact to the poisha', exact, true);
if (!exact) console.log('        first bad:', JSON.stringify(firstBad));

// --- refusals are refusals, not silent zeroes -------------------------------
// The old code produced NaN for these, and NaN is falsy, so a typo looked like "no COD".
for (const bad of ['abc', '৳50', '1.2.3', '--5', '1e3', '1/2', '12,34.56.78', '+50', '  .  .  ']) {
  check(`refused: ${JSON.stringify(bad)}`, parseAmountMinor(bad), null);
}
check('a NaN is never returned', [Number.isNaN(parseAmountMinor('abc'))], [false]);
check('undefined is never returned', [parseAmountMinor('abc') === undefined], [false]);

// --- the ceiling ------------------------------------------------------------
check('the largest accepted amount', parseAmountMinor('99999999.99'), 9_999_999_999);
check('one taka over the ceiling is refused', parseAmountMinor('100000000'), null);
check('and says why', parseAmount('100000000').error, 'That amount is too large');
check('a silly digit count is refused, not truncated', parseAmountMinor('1'.repeat(400)), null);

// --- the error is present exactly when the parse failed ---------------------
for (const ok of ['0', '1250.55', '', '1,000']) {
  check(`no error for a usable amount: ${JSON.stringify(ok)}`, parseAmount(ok).error, null);
}
for (const bad of ['abc', '1.005', '100000000']) {
  check(
    `an error for an unusable amount: ${JSON.stringify(bad)}`,
    typeof parseAmount(bad).error,
    'string',
  );
}

// --- rendering, including the sign -----------------------------------------
// The sign belongs outside the currency symbol. `Intl` puts it on the number, so prefixing the
// symbol without taking the absolute value first rendered every correction as `৳-0.50` — the
// format of every debit row on every statement, found by looking at a real one.
// There is a space after the symbol. It was not there until the formatter moved to
// `@zipzap/lexicon`, and the tie-break went to the space because the design system's `MoneyText` had
// always rendered it and that component exists to make every amount on a screen agree: a package whose
// rule forced it to be the sole violator would be arguing with its own design system. The rider's phone
// and the prose here both moved to match.
check('a positive amount', formatMinor(125050, 'BDT'), '৳ 1,250.50');
check('a negative amount signs the currency, not the number', formatMinor(-50, 'BDT'), '-৳ 0.50');
check('zero has no sign', formatMinor(0, 'BDT'), '৳ 0.00');
check('the symbol is never inside the digits', /৳\s?-/.test(formatMinor(-1, 'BDT')), false);
check('other currencies sign the same way', formatMinor(-12345, 'USD'), '-$ 123.45');
// -0 compares equal to 0, so a refund of nothing must not print a minus.
check('a refund of nothing prints no minus', formatMinor(-0, 'BDT'), '৳ 0.00');
check('the sign survives a large debit', formatMinor(-9_999_999_999, 'BDT'), '-৳ 99,999,999.99');

console.log(failures === 0 ? '\nmoney parsing ok' : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
