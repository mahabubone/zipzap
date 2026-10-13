import { cx } from '../lib/cx.ts';

export interface BrandMarkProps {
  /** Square. The mark is a bolt on a rounded tile, so it only reads correctly at equal sides. */
  readonly className?: string;
}

/**
 * The ZipZap mark.
 *
 * ## Why it lives in the kit rather than in each app
 *
 * It was copy-pasted into four files — merchant console, public tracking, hub console, and the
 * control tower had none at all, which is why that app's login screen showed bare text while its three
 * siblings showed a mark. Four copies of an identity is four places to change when the brand changes,
 * and one of them will be missed; the one that gets missed is the one nobody looks at, because the
 * people who own it do not use that app.
 *
 * The *placement* is still the app's: `AppShell` takes `brand` as a slot rather than hard-coding this,
 * so a surface that must not carry the mark — an embed, a partner's white-label, an email receipt — can
 * pass something else. Ownership of where the mark goes and ownership of what it looks like are
 * different questions, and only the second one belongs to the kit.
 *
 * `aria-hidden` and `focusable="false"`: the mark is decoration next to a wordmark or a page title,
 * and an `<svg>` with no title is announced as "graphic" by some screen readers — noise where the
 * name is already on screen.
 */
export function BrandMark({ className = 'size-8' }: BrandMarkProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <rect width="32" height="32" rx="8" className="fill-brand-600" />
      <path
        d="M18.5 6 9 18h6l-1.5 8L23 14h-6l1.5-8Z"
        className="fill-white"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface WordmarkProps {
  readonly className?: string;
  /** The name, so a white-label surface can say something else without forking the component. */
  readonly name?: string;
  readonly markClassName?: string;
}

/** The mark and the name together. What a header should carry when the product is the subject. */
export function Wordmark({ className, name = 'ZipZap', markClassName = 'size-8' }: WordmarkProps) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <BrandMark className={markClassName} />
      <span className="text-lg font-semibold tracking-tight text-slate-900">{name}</span>
    </span>
  );
}
