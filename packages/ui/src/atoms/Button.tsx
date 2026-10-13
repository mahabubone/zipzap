import { cloneElement, isValidElement, type ButtonHTMLAttributes, type ReactElement } from 'react';
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

const base =
  'inline-flex items-center justify-center rounded-md font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  readonly size?: Size;
  /**
   * Render as this child instead of a `<button>`, keeping the styling.
   *
   * For a link that should look like a button. The alternative in every React codebase is an `<a>`
   * wrapped around a `<Button>`, which is interactive content inside interactive content: invalid
   * HTML, two tab stops where the author expects one, and a screen reader that announces the link
   * and the button separately. The landing page had four of them.
   *
   * Pass the one element to become: `<Button asChild><Link to="/login">Sign in</Link></Button>`.
   * Its own `className` is kept and the button's classes are appended, so a caller who wants to add
   * something does not have to choose between their class and the variant's.
   */
  readonly asChild?: boolean;
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
  asChild = false,
  children,
  ...rest
}: ButtonProps) {
  const classes = cx(base, variants[variant], sizes[size], className);

  if (asChild) {
    // `Button`'s classes land on the child, and `type` does not: a link has no `type`, and spreading
    // one onto an `<a>` is invalid HTML that some browsers reflect back as an attribute.
    const child = children;
    if (!isValidElement(child)) return null;
    const element = child as ReactElement<Record<string, unknown>>;
    const { className: childClass, ...childRest } = element.props ?? {};
    return cloneElement(element, {
      ...rest,
      ...childRest,
      className: cx(classes, typeof childClass === 'string' ? childClass : undefined),
    });
  }

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
