import { isValidElement, useId, useState, type ReactElement, type ReactNode } from 'react';
import { cx } from '../lib/cx.ts';

/**
 * Is this element already in the tab order?
 *
 * A single element check, and deliberately shallow: the answer only decides whether *this wrapper*
 * needs a tab stop, and every caller in this product passes a `<button>` or a `<span>` of text. A
 * deep walk would answer a question nobody asked.
 */
function isFocusable(children: ReactNode): boolean {
  if (!isValidElement(children)) return false;
  const element = children as ReactElement<Record<string, unknown>>;
  if (element.props?.disabled === true) return false;
  const tag = typeof element.type === 'string' ? element.type : '';
  return (
    tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea'
  );
}

export interface TooltipProps {
  readonly label: string;
  readonly children: ReactNode;
  readonly side?: 'top' | 'bottom';
  readonly className?: string;
}

/** CSS-only hover/focus tooltip — no positioning library. Fine for short labels;
 *  add a collision-aware popper when you need edge flipping. */
export function Tooltip({ label, children, side = 'top', className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  /**
   * Whether the child is already focusable on its own.
   *
   * A tooltip around a `<button>` — which is every use of it in this product — must not add a tab
   * stop of its own: the button is the thing you tab to, and a second stop in front of it means
   * every tooltip costs a keystroke for no information. Detected from the element rather than
   * passed in, because a prop that says "this child is focusable" is a prop that will be wrong.
   */
  const focusable = isFocusable(children);

  return (
    <span
      className={cx('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span
        aria-describedby={open ? id : undefined}
        // Not `outline-none`, and `tabIndex` only when the child cannot take focus itself.
        //
        // The wrapper was focusable and outline-free: a second tab stop in the middle of the page
        // whose focus you could not see. `outline-none` there was not a style choice, it was the
        // removal of the only signal a keyboard user had that focus had arrived.
        tabIndex={focusable ? undefined : 0}
        className="inline-flex focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {children}
      </span>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={cx(
            'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white',
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          )}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
