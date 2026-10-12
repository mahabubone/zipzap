const UNITS: Record<string, number> = { BDT: 100, USD: 100, EUR: 100 };

const SYMBOLS: Record<string, string> = { BDT: '৳', USD: '$', EUR: '€' };

/** Grouping only — the fraction is appended by hand, see `MoneyText`. */
const grouping = new Intl.NumberFormat('en-BD', { maximumFractionDigits: 0 });

export interface MoneyTextProps {
  /** Integer minor units — never a float. `125050` with `BDT` renders `৳ 1,250.50`. */
  readonly amountMinor: number;
  readonly currency: keyof typeof UNITS;
  readonly className?: string;
}

export function MoneyText({ amountMinor, currency, className }: MoneyTextProps) {
  const scale = UNITS[currency] ?? 100;
  // Split in integer space. `amountMinor / scale` is a float and the nearest double to the
  // largest safe integer is 1/100 of a minor unit short, so it renders `...409.90` for an
  // amount that is `...409.91`. Same split the backend's `money.format()` uses, so the
  // invoice PDF and the screen can never disagree by a poisha. See docs/ADR/0009.
  const decimals = String(scale).length - 1;
  const sign = amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(amountMinor);
  const major = grouping.format(Math.trunc(absolute / scale));
  const minor = (absolute % scale).toString().padStart(decimals, '0');
  return (
    <span className={className}>
      {SYMBOLS[currency]} {sign}
      {major}.{minor}
    </span>
  );
}
