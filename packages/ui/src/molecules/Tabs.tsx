import type { ReactNode } from 'react';
import { cx } from '../lib/cx.ts';

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly badge?: ReactNode;
}

export interface TabsProps {
  readonly items: ReadonlyArray<TabItem>;
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly className?: string;
}

export function Tabs({ items, value, onChange, className }: TabsProps) {
  return (
    <div role="tablist" className={cx('flex gap-1 border-b border-slate-200', className)}>
      {items.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cx(
              '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition',
              active
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )}
          >
            {t.label}
            {t.badge ? <span className="text-xs text-slate-400">{t.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  readonly value: string;
  readonly when: string;
  readonly children: ReactNode;
}

export function TabPanel({ value, when, children }: TabPanelProps) {
  if (value !== when) return null;
  return (
    <div role="tabpanel" className="py-4">
      {children}
    </div>
  );
}
