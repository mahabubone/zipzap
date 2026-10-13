/**
 * Phone normalisation, asserted without a test framework.
 *
 * merchant-web has no vitest and this does not add one: the frontend convention in this
 * repo is a zero-dependency `verify-*.mjs` script (see verify-client.mjs), and a normaliser
 * that quietly returns null would send `017…` to a server that only accepts `+8801…` and
 * return a 400 the merchant cannot act on.
 *
 * Run: node apps/frontends/merchant-web/scripts/verify-phone.mjs
 */
import { toE164 } from '../src/lib/phone.ts';

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

// How a merchant actually types it.
check('017… local form', toE164('01712345678'), '+8801712345678');
check('018… local form', toE164('01812345678'), '+8801812345678');
check('019… local form', toE164('01912345678'), '+8801912345678');
check('already correct', toE164('+8801712345678'), '+8801712345678');

// The ways people paste the same number.
check('spaced', toE164('017 1234 5678'), '+8801712345678');
check('dashed', toE164('017-1234-5678'), '+8801712345678');
check('dotted', toE164('017.1234.5678'), '+8801712345678');
check('international 00', toE164('008801712345678'), '+8801712345678');
check('international bare', toE164('8801712345678'), '+8801712345678');
check('national without trunk 0', toE164('1712345678'), '+8801712345678');
check('surrounded by spaces', toE164('  01712345678  '), '+8801712345678');
check('idempotent', toE164(toE164('01712345678')), '+8801712345678');

// What the server regex rejects — caught here, not as a 400 from the API.
check('invalid prefix 012', toE164('01212345678'), null);
check('invalid prefix 011', toE164('01112345678'), null);
check('too short', toE164('0171234567'), null);
check('too long', toE164('017123456789'), null);
check('empty', toE164(''), null);
check('blank', toE164('   '), null);
check('not a number', toE164('not a phone'), null);
check('another country', toE164('+14155550123'), null);

console.log(failures === 0 ? '\nphone normalisation ok' : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
