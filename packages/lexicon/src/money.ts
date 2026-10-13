/**
 * Money as a string, and the arithmetic that guarantees three surfaces write the same one.
 *
 * ## Integer minor units, and no exceptions here either
 *
 * Rule 4 of this repository says money is integer minor units and never a float. That rule was being
 * followed in three places and broken in the same three places by the *formatting*: `minor / 100` is a
 * float, and the nearest double to the largest safe integer is one hundredth of a minor unit short of
 * it — so an amount renders `…409.90` for a figure that is `…409.91`. The backend avoids it by
 * splitting in integer space, the rider's `formatCash` did it correctly by accident, and the web kit
 * needed a comment to remember to.
 *
 * So the split lives here once, in integers, and every caller gets it.
 *
 * ## No `Intl`
 *
 * Deliberate, and it is what makes this package shareable. `Intl.NumberFormat` with `'en-BD'` and
 * `'en-US'` is not the same format, Hermes' `Intl` support is partial, and a taka grouping difference
 * between a merchant's invoice and a rider's phone screen is not a bug anyone would report — it is
 * just a thing that is true. The grouping is three characters of regular expression and it is exact.
 *
 * ## Why there is a space after the symbol
 *
 * `৳ 1,250.50`, because that is what the design system's `MoneyText` has always rendered and what
 * every screenshot shows. The tie-break went to the component rather than to the string: `MoneyText`
 * exists to make every amount on a screen agree, and a package whose rule forced that component to be
 * the sole violator would be arguing with its own design system. The backend's `money.format()`
 * returns `1,250.50` with no symbol at all — the symbol is a display decision on every surface, so
 * there is no server string to disagree with.
 */

const MINOR_UNITS: Readonly<Record<string, number>> = { BDT: 100, USD: 100, EUR: 100 };
const SYMBOLS: Readonly<Record<string, string>> = { BDT: '৳', USD: '$', EUR: '€' };

/** Thousands separators, without `Intl` and without a float anywhere near it. */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The parts of an amount, so a renderer can style them separately without redoing the arithmetic. */
export interface SplitMinor {
  readonly sign: '' | '-';
  readonly symbol: string;
  /** Grouped, no sign: `1,250`. */
  readonly major: string;
  /** Zero-padded to the currency's precision: `50`. */
  readonly minor: string;
}

/**
 * Split an integer amount into its parts, in integer space.
 *
 * `Math.trunc(absolute / scale)` is the only division, and it is exact for every safe integer because
 * `absolute` is an integer and the quotient is smaller than it.
 */
export function splitMinor(amountMinor: number, currency: string): SplitMinor {
  const scale = MINOR_UNITS[currency] ?? 100;
  const decimals = String(scale).length - 1;
  const sign = amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(amountMinor);
  return {
    sign,
    symbol: SYMBOLS[currency] ?? '',
    major: group(Math.trunc(absolute / scale).toString()),
    minor: (absolute % scale).toString().padStart(decimals, '0'),
  };
}

/**
 * `125050` + `BDT` → `৳ 1,250.50`. `-50` → `-৳ 0.50`.
 *
 * The sign goes **outside** the symbol. `Intl` puts it on the number, so the naive composition yields
 * `৳ -0.50`, which reads as a corrupted currency sign followed by a stray dash — and it is the format
 * of every correction row on every statement.
 */
export function formatMinor(amountMinor: number, currency: string): string {
  const { sign, symbol, major, minor } = splitMinor(amountMinor, currency);
  return `${sign}${symbol} ${major}.${minor}`;
}

/**
 * The API's decimal string → integer minor units.
 *
 * Exact because the value is an integer: `Number` is precise below 2^53 and nothing here exceeds it.
 */
export function minorOf(decimalString: string): number {
  return Number(decimalString);
}
