import type { InputHTMLAttributes } from 'react';
import { cx } from '../lib/cx.ts';

export type RadioProps = InputHTMLAttributes<HTMLInputElement>;

export function Radio({ className, ...rest }: RadioProps) {
  return (
    <input
      type="radio"
      className={cx(
        'size-4 shrink-0 border-slate-300 text-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        className,
      )}
      {...rest}
    />
  );
}
