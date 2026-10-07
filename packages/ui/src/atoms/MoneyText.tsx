const UNITS: Record<string, number> = { BDT: 100, USD: 100, EUR: 100 };

const SYMBOLS: Record<string, string> = { BDT: '৳', USD: '$', EUR: '€' };

export interface MoneyTextProps {
  /** Integer minor units — never a float. `125050` with `BDT` renders `৳ 1,250.50`. */
  readonly amountMinor: number;
  readonly currency: keyof typeof UNITS;
  readonly className?: string;
}

export function MoneyText({ amountMinor, currency, className }: MoneyTextProps) {
  const major = amountMinor / (UNITS[currency] ?? 100);
  const formatted = new Intl.NumberFormat('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
  return (
    <span className={className}>
      {SYMBOLS[currency]} {formatted}
    </span>
  );
}
