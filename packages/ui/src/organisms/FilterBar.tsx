import type { ReactNode } from 'react';
import { Button } from '../atoms/Button.tsx';
import { SearchInput } from '../molecules/SearchInput.tsx';
import { cx } from '../lib/cx.ts';

export interface FilterBarProps {
  readonly searchValue: string;
  readonly onSearchChange: (value: string) => void;
  readonly searchPlaceholder?: string;
  /** Selects, date pickers, status toggles. */
  readonly children?: ReactNode;
  readonly onReset?: () => void;
  /** Show "Clear" only when something is active. Defaults to `!!onReset`. */
  readonly showReset?: boolean;
  readonly className?: string;
}

/** Toolbar above a DataTable: search on the left, filters, then a reset when dirty. */
export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  children,
  onReset,
  showReset,
  className,
}: FilterBarProps) {
  const dirty = searchValue !== '' || showReset === true;
  return (
    <div className={cx('flex flex-wrap items-center gap-2', className)}>
      <SearchInput
        value={searchValue}
        onChange={onSearchChange}
        placeholder={searchPlaceholder ?? 'Search…'}
      />
      {children ? (
        <div className="flex flex-wrap items-center gap-2 [&_select]:w-auto [&_input]:w-auto">
          {children}
        </div>
      ) : null}
      {onReset && dirty ? (
        <Button variant="ghost" size="sm" onClick={onReset}>
          Clear
        </Button>
      ) : null}
    </div>
  );
}
