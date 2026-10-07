import type { ReactNode } from 'react';
import { StatCard } from '../molecules/StatCard.tsx';
import { cx } from '../lib/cx.ts';

export interface Kpi {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: string;
}

export interface KpiRowProps {
  readonly items: ReadonlyArray<Kpi>;
  /** Responsive grid: 2 on mobile, 4 from `lg`. */
  readonly columns?: 2 | 3 | 4;
  readonly className?: string;
}

const COLS: Record<2 | 3 | 4, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
};

export function KpiRow({ items, columns = 4, className }: KpiRowProps) {
  return (
    <div className={cx('grid gap-4', COLS[columns], className)}>
      {items.map((k) => (
        <StatCard key={k.label} label={k.label} value={k.value} hint={k.hint} />
      ))}
    </div>
  );
}
