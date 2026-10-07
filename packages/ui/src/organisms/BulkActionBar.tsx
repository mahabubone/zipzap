import type { ReactNode } from 'react';
import { cx } from '../lib/cx.ts';

export interface BulkActionBarProps {
  readonly count: number;
  /** Noun for the selected rows: "3 shipments selected". */
  readonly noun?: string;
  readonly onClear: () => void;
  readonly children?: ReactNode;
  readonly className?: string;
}

/** Sticky bar that replaces the toolbar while rows are selected. Render it
 *  instead of (not on top of) the FilterBar so the row height stays stable. */
export function BulkActionBar({
  count,
  noun = 'rows',
  onClear,
  children,
  className,
}: BulkActionBarProps) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className={cx(
        'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-500/5 px-4 py-2',
        className,
      )}
    >
      <p className="text-sm font-medium text-brand-800">
        {count} {noun} selected
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <button
          type="button"
          onClick={onClear}
          className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
