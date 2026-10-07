import { Fragment } from 'react';
import { cx } from '../lib/cx.ts';

export interface Crumb {
  readonly label: string;
  readonly href?: string;
}

export function Breadcrumbs({
  items,
  className,
}: {
  readonly items: ReadonlyArray<Crumb>;
  readonly className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={cx('text-sm', className)}>
      <ol className="flex flex-wrap items-center gap-1.5 text-slate-500">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={`${c.label}-${i}`}>
              {c.href && !last ? (
                <a href={c.href} className="hover:text-slate-800 hover:underline">
                  {c.label}
                </a>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={last ? 'font-medium text-slate-800' : undefined}
                >
                  {c.label}
                </span>
              )}
              {last ? null : (
                <span aria-hidden className="text-slate-300">
                  /
                </span>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
