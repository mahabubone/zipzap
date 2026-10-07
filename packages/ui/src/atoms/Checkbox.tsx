import type { InputHTMLAttributes, Ref } from 'react';
import { cx } from '../lib/cx.ts';

export interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Forwarded so callers can set `.indeterminate` on a tri-state header checkbox. */
  readonly inputRef?: Ref<HTMLInputElement>;
}

export function Checkbox({ inputRef, className, ...rest }: CheckboxProps) {
  return (
    <input
      ref={inputRef}
      type="checkbox"
      className={cx(
        'size-4 rounded border-slate-300 text-brand-600 focus-visible:outline-brand-600',
        className,
      )}
      {...rest}
    />
  );
}
