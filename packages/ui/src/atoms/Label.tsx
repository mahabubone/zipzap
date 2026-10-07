import type { LabelHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx.ts';

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /** Renders a red asterisk and marks the field required for screen readers. */
  readonly required?: boolean;
  readonly children: ReactNode;
}

export function Label({ required, className, children, ...rest }: LabelProps) {
  return (
    <label className={cx('text-sm font-medium text-slate-700', className)} {...rest}>
      {children}
      {required ? (
        <span aria-hidden className="ml-0.5 text-red-600">
          *
        </span>
      ) : null}
    </label>
  );
}
