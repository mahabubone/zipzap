import { cx } from '../lib/cx.ts';

const tones = ['bg-brand-600', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-600', 'bg-violet-600'];

export function Avatar({
  name,
  className,
}: {
  readonly name: string;
  readonly className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  const tone = tones[(name.charCodeAt(0) || 0) % tones.length];
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex size-9 items-center justify-center rounded-full text-xs font-semibold text-white',
        tone,
        className,
      )}
    >
      {initials}
    </span>
  );
}
