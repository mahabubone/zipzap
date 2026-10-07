import type { InputHTMLAttributes } from 'react';
import { cx } from '../lib/cx.ts';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly invalid?: boolean;
}

export function Input({ invalid, className, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cx(
        'h-10 w-full rounded-md border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand-600',
        invalid ? 'border-red-400' : 'border-slate-300',
        className,
      )}
      {...rest}
    />
  );
}
