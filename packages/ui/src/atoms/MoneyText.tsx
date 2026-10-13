import { formatMinor } from '@zipzap/lexicon';

export interface MoneyTextProps {
  /** Integer minor units — never a float. `125050` with `BDT` renders `৳ 1,250.50`. */
  readonly amountMinor: number;
  readonly currency: string;
  readonly className?: string;
}

/**
 * An amount, written the way the rest of the product writes it.
 *
 * It used to do its own arithmetic: split in integer space (correct — `amountMinor / 100` is a float,
 * and the nearest double to the largest safe integer is a hundredth of a minor unit short of it), group
 * with `Intl.NumberFormat('en-BD')`, and put a space after the symbol. Three things were decided here
 * and two of them disagreed with the other formatters in the product.
 *
 * So it calls `@zipzap/lexicon` and renders the result verbatim. This component exists to make every
 * amount on a screen agree, so it must not be the component that disagrees: it used to render
 * `৳ 1,250.50` where the prose formatter said `৳1,250.50` and the rider's phone said `৳1,250.50`, and a
 * statement and a screen must never differ by even a space.
 *
 * There is no style prop for the parts any more, and adding one would be how the space came back.
 */
export function MoneyText({ amountMinor, currency, className }: MoneyTextProps) {
  return <span className={className}>{formatMinor(amountMinor, currency)}</span>;
}
