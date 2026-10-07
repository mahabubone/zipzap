import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/cx.ts';

export interface DropdownProps {
  /** Button that opens the menu. Rendered as-is, so pass a `<Button>` or `<button>`. */
  readonly trigger: ReactNode;
  readonly children: ReactNode | ((close: () => void) => ReactNode);
  readonly align?: 'start' | 'end';
  readonly className?: string;
}

/** Uncontrolled dropdown: click-outside and Escape close it. Not a menu primitive —
 *  give it focusable children (`role="menuitem"`, inputs) yourself. */
export function Dropdown({ trigger, children, align = 'end', className }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className={cx('relative inline-block', className)}>
      <div
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        {trigger}
      </div>
      {open ? (
        <div
          className={cx(
            'absolute z-40 mt-1 min-w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

export interface DropdownItemProps {
  readonly onSelect: () => void;
  readonly children: ReactNode;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function DropdownItem({
  onSelect,
  children,
  danger,
  disabled,
  className,
}: DropdownItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition',
        danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-100',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function DropdownLabel({ children }: { readonly children: ReactNode }) {
  return (
    <p className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </p>
  );
}

/** Checkbox row for the DataTable's column-visibility menu. */
export function DropdownCheck({
  checked,
  onChange,
  children,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly children: ReactNode;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-slate-300 text-brand-600"
      />
      {children}
    </label>
  );
}
