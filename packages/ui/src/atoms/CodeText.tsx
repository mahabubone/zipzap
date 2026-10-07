import { cx } from '../lib/cx.ts';

export function CodeText({
  value,
  className,
}: {
  readonly value: string;
  readonly className?: string;
}) {
  return (
    <code
      className={cx(
        'rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-medium text-slate-800',
        className,
      )}
    >
      {value}
    </code>
  );
}
