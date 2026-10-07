import type { TextareaHTMLAttributes } from 'react';
import { cx } from '../lib/cx.ts';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly invalid?: boolean;
}

export function Textarea({ invalid, className, ...rest }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cx(
        'min-h-20 w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-brand-600',
        invalid ? 'border-red-400' : 'border-slate-300',
        className,
      )}
      {...rest}
    />
  );
}
