import type { ReactNode } from 'react';
import { Radio } from '../atoms/Radio.tsx';
import { cx } from '../lib/cx.ts';

export interface RadioGroupOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
}

export interface RadioGroupProps {
  readonly name: string;
  readonly value: string;
  readonly options: ReadonlyArray<RadioGroupOption>;
  readonly onChange: (value: string) => void;
  /** Vertical stack (default) or inline row. */
  readonly orientation?: 'vertical' | 'horizontal';
  readonly className?: string;
}

export function RadioGroup({
  name,
  value,
  options,
  onChange,
  orientation = 'vertical',
  className,
}: RadioGroupProps) {
  return (
    <div
      role="radiogroup"
      className={cx(
        'flex gap-3',
        orientation === 'vertical' ? 'flex-col' : 'flex-wrap items-center gap-6',
        className,
      )}
    >
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-start gap-2 text-sm">
          <Radio
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-slate-800">{o.label}</span>
            {o.description ? (
              <span className="mt-0.5 block text-xs text-slate-500">{o.description}</span>
            ) : null}
          </span>
        </label>
      ))}
    </div>
  );
}

/** Narrow wrapper for the common "a few mutually exclusive inputs" case. */
export function RadioCards({
  name,
  value,
  options,
  onChange,
}: {
  readonly name: string;
  readonly value: string;
  readonly options: ReadonlyArray<RadioGroupOption & { readonly icon?: ReactNode }>;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div role="radiogroup" className="grid gap-3 sm:grid-cols-2">
      {options.map((o) => (
        <label
          key={o.value}
          className={cx(
            'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition',
            value === o.value
              ? 'border-brand-600 bg-brand-500/5 ring-1 ring-brand-600'
              : 'border-slate-200 bg-white hover:bg-slate-50',
          )}
        >
          <Radio
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="mt-0.5"
          />
          <span className="flex-1">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
              {o.icon}
              {o.label}
            </span>
            {o.description ? (
              <span className="mt-0.5 block text-xs text-slate-500">{o.description}</span>
            ) : null}
          </span>
        </label>
      ))}
    </div>
  );
}
