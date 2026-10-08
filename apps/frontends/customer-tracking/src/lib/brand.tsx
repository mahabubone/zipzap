/**
 * Brand mark. Duplicated from merchant-web rather than extracted — see useAsync.ts.
 * Only `Logo`: the tracking pages carry no wordmark, because a recipient already
 * knows who shipped the parcel and the header must stay quiet.
 */
export function Logo({ className = 'size-8' }: { readonly className?: string }) {
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
