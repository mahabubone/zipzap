import { cx } from '../lib/cx.ts';

export function Skeleton({ className }: { readonly className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-slate-200', className)} aria-hidden />;
}
