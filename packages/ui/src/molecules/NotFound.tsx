import type { ReactNode } from 'react';
import { cx } from '../lib/cx.ts';

export interface NotFoundProps {
  /** What was being looked for, in the app's own words: "that shipment", "that tracking code". */
  readonly subject?: string;
  readonly description?: string;
  /** The way out. A link, a button — whatever the app already navigates with. */
  readonly action?: ReactNode;
  readonly className?: string;
}

/**
 * A 404, in the kit's voice.
 *
 * Every app here rendered TanStack Router's default when a URL did not match, which is an unstyled
 * development default in the middle of a branded product. A visitor who mistypes a tracking code, or
 * follows a stale link from an old campaign, sees a page that looks like the app has crashed.
 *
 * It states the miss, says what can be done instead, and renders the app's own way out — so a 404 is
 * a dead end somebody can act on rather than a dead end at all.
 */
export function NotFound({ subject = 'that page', description, action, className }: NotFoundProps) {
  return (
    <div
      className={cx(
        'mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center',
        className,
      )}
    >
      <p className="text-sm font-medium tracking-wide text-slate-400 uppercase">Not found</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">We could not find {subject}</h1>
      {description ? <p className="mt-3 text-sm text-slate-600">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
