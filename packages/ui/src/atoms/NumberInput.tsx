import type { InputHTMLAttributes } from 'react';
import { cx } from '../lib/cx.ts';

/** Integer-only input for money in minor units. Strips anything but digits —
 *  1250.50 can never be typed, per the money rule. */
export function NumberInput({
  className,
  onChange,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      inputMode="numeric"
      pattern="[0-9]*"
      onKeyDown={(e) => {
        if (e.key === '.' || e.key === 'e' || e.key === 'E' || e.key === '-') e.preventDefault();
      }}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^0-9]/g, '');
        if (digits !== e.target.value) e.target.value = digits;
        onChange?.(e);
      }}
      className={cx(
        'h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-brand-600',
        className,
      )}
      {...rest}
    />
  );
}
