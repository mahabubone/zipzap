import { cx } from '../lib/cx.ts';

type Tone = 'brand' | 'success' | 'warning' | 'danger';

const tones: Record<Tone, string> = {
  brand: 'bg-brand-600',
  success: 'bg-emerald-600',
  warning: 'bg-amber-500',
  danger: 'bg-red-600',
};

export interface ProgressProps {
  /** 0–100. Values outside are clamped. */
  readonly value: number;
  readonly tone?: Tone;
  readonly label?: string;
  readonly className?: string;
}

export function Progress({ value, tone = 'brand', label, className }: ProgressProps) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cx('h-2 w-full overflow-hidden rounded-full bg-slate-200', className)}
    >
      <div
        className={cx('h-full rounded-full transition-[width]', tones[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
