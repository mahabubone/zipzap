import type { SelectHTMLAttributes } from 'react';
import { cx } from '../lib/cx.ts';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly invalid?: boolean;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
}

export function Select({ invalid, options, className, ...rest }: SelectProps) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cx(
        'h-10 w-full rounded-md border bg-white px-3 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-600',
        invalid ? 'border-red-400' : 'border-slate-300',
        className,
      )}
      {...rest}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
