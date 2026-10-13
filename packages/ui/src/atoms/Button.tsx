import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../lib/cx.ts';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
  destructive: 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  readonly size?: Size;
}

/**
 * `type` defaults to `"button"`.
 *
 * The HTML default is `submit`, so a `Button` rendered inside a `<form>` submitted that form whether
 * or not anybody meant it to: an `ErrorState`'s Retry, an `EmptyState`'s action, a filter's Clear.
 * The form went away with its values, and the screen looked like it had worked.
 *
 * Every form in this product states `type="submit"` on the button that submits it, so making the
 * default the safe one costs nothing and removes a class of accident. `pnpm typecheck` cannot catch
 * this one — it is a behaviour, not a type.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center rounded-md font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    />
  );
}
