/**
 * Money. Integer minor units plus a currency. Never a float.
 *
 * See docs/architecture/money-and-ledger.md and docs/ADR/0009-money-representation.md.
 * No floats appear anywhere in this file, and none may be introduced into it.
 */

export const CURRENCIES = ['BDT'] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface Money {
  readonly amountMinor: number;
  readonly currency: Currency;
}

export function money(amountMinor: number, currency: Currency = 'BDT'): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new RangeError(
      `Money must be an integer count of minor units, received ${amountMinor}. ` +
        'Never construct money from a float — see docs/ADR/0009.',
    );
  }
  return Object.freeze({ amountMinor, currency });
}

/** Parse a major-unit string like "1250.50". The only sanctioned entry point from user input. */
export function parseMajor(value: string, currency: Currency = 'BDT'): Money {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    throw new RangeError(`Cannot parse money from "${value}": expected a decimal amount.`);
  }
  const [, sign, major, minor = ''] = match;
  const fraction = minor.padEnd(2, '0');
  const amountMinor = Number.parseInt(`${major}${fraction}`, 10);
  return money(sign === '-' ? -amountMinor : amountMinor, currency);
}

/** Render for display. Display only — never feed the result back into arithmetic. */
export function format(value: Money): string {
  const sign = value.amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(value.amountMinor);
  const major = Math.trunc(absolute / 100);
  const minor = absolute % 100;
  return `${sign}${major.toLocaleString('en-US')}.${minor.toString().padStart(2, '0')}`;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new RangeError(
      `Cannot combine ${a.currency} and ${b.currency}. Converting is a business rule, ` +
        'not arithmetic.',
    );
  }
}

export const add = (a: Money, b: Money): Money => {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
};

export const subtract = (a: Money, b: Money): Money => {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
};

/** Multiply by a whole quantity, such as a parcel count. Never by a rate. */
export const multiply = (value: Money, quantity: number): Money => {
  if (!Number.isInteger(quantity)) {
    throw new RangeError(`Quantity must be an integer, received ${quantity}.`);
  }
  return money(value.amountMinor * quantity, value.currency);
};

export const negate = (value: Money): Money => money(-value.amountMinor, value.currency);

export const sum = (values: readonly Money[]): Money =>
  values.reduce(add, money(0, values[0]?.currency ?? 'BDT'));

export const isZero = (value: Money): boolean => value.amountMinor === 0;
export const isPositive = (value: Money): boolean => value.amountMinor > 0;
export const isNegative = (value: Money): boolean => value.amountMinor < 0;

/**
 * Split an amount across weights without losing or inventing a single minor unit.
 *
 * The remainder goes to the first share, by policy. Losing 3 poisha per shipment across
 * 10,000 shipments is a discrepancy nobody finds for a month.
 */
export function allocate(total: Money, ...weights: readonly number[]): Money[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) {
    throw new RangeError('Allocation weights must sum to a positive number.');
  }
  const shares = weights.map((weight) => Math.floor((total.amountMinor * weight) / weightTotal));
  const remainder = total.amountMinor - shares.reduce((sum, share) => sum + share, 0);
  if (shares.length > 0) {
    shares[0] = (shares[0] ?? 0) + remainder;
  }
  return shares.map((share) => money(share, total.currency));
}

/** Basis points. 250 bps = 2.5%. Integer in, integer out — the remainder is not silently lost. */
export function applyBasisPoints(value: Money, basisPoints: number): Money {
  if (!Number.isInteger(basisPoints)) {
    throw new RangeError(`Basis points must be an integer, received ${basisPoints}.`);
  }
  return money(Math.trunc((value.amountMinor * basisPoints) / 10_000), value.currency);
}
