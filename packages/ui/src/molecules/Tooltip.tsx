import { useId, useState, type ReactNode } from 'react';
import { cx } from '../lib/cx.ts';

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
        tabIndex={0}
        className="inline-flex outline-none"
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
