import { useState, type ReactNode } from 'react';
import { cx } from '../lib/cx.ts';

export interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly active?: boolean;
  /** Slot, not a name — the app owns its icon set. Falls back to an initial. */
  readonly icon?: ReactNode;
  /** Count or status, e.g. pickups awaiting assignment. */
  readonly badge?: ReactNode;
}

export interface NavGroup {
  /** Omit for an unlabelled block. */
  readonly label?: string;
  readonly items: ReadonlyArray<NavItem>;
}

export interface AppShellProps {
  readonly brand: ReactNode;
  readonly nav: ReadonlyArray<NavGroup>;
  readonly topbar?: ReactNode;
  /** Sidebar footer — account switcher, build version, sign-out. */
  readonly sidebarFooter?: ReactNode;
  /** Label for the skip link; keep it short and specific. */
  readonly skipLabel?: string;
  /** Replace the nav's plain `<a>` with your router's Link — without this every
   *  nav click is a full document reload. Omit it for a plain-anchor shell. */
  readonly renderLink?: NavLinkRender;
  readonly children: ReactNode;
}

export type NavLinkRender = (link: {
  readonly href: string;
  readonly className: string;
  readonly children: ReactNode;
  readonly 'aria-current'?: 'page';
  /** Fires on click — the shell uses it to close the mobile drawer. */
  readonly onNavigate: () => void;
}) => ReactNode;

function NavLink({
  item,
  collapsed,
  onNavigate,
  renderLink,
}: {
  readonly item: NavItem;
  readonly collapsed: boolean;
  readonly onNavigate: () => void;
  readonly renderLink?: NavLinkRender;
}) {
  const className = cx(
    'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition',
    item.active
      ? 'bg-brand-500/10 font-medium text-brand-700'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  );
  const activeBar = item.active ? (
    <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-600" />
  ) : null;
  const content = collapsed ? (
    <>
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center text-slate-400">
        {item.icon ?? item.label.charAt(0)}
      </span>
      <span className="sr-only">{item.label}</span>
    </>
  ) : (
    <>
      {item.icon ?? null}
      {activeBar}
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge ? <span className="shrink-0">{item.badge}</span> : null}
    </>
  );

  if (renderLink) {
    return (
      <>
        {renderLink({
          href: item.href,
          className,
          children: content,
          'aria-current': item.active ? 'page' : undefined,
          onNavigate,
        })}
      </>
    );
  }
  return (
    <a
      href={item.href}
      aria-current={item.active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      onClick={onNavigate}
      className={className}
    >
      {content}
    </a>
  );
}

/** Console frame: grouped sidebar + sticky topbar + content.
 *
 *  Router-agnostic — nav items are plain anchors; the consuming app maps them to
 *  its router and owns `active`. Sidebar collapses to icons on desktop and to an
 *  overlay drawer below `lg`.
 *
 *  ponytail: collapse state is local and not persisted. Read the pref in an
 *  effect and call `setCollapsed` if you want it remembered across reloads. */
export function AppShell({
  brand,
  nav,
  topbar,
  sidebarFooter,
  skipLabel = 'Skip to content',
  renderLink,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[auto_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg"
      >
        {skipLabel}
      </a>

      {mobileOpen ? (
        <div
          aria-hidden
          onClick={closeMobile}
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
        />
      ) : null}

      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200 bg-white transition-[width,transform] duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          collapsed ? 'w-16' : 'w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div
          className={cx(
            'flex h-14 shrink-0 items-center border-b border-slate-200',
            collapsed ? 'justify-center px-2' : 'gap-2 px-5',
          )}
        >
          <span className="truncate text-base font-semibold tracking-tight text-slate-900">
            {brand}
          </span>
        </div>

        <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto p-3">
          {nav.map((group, gi) => (
            <div key={group.label ?? `group-${gi}`}>
              {group.label && !collapsed ? (
                <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {group.label}
                </p>
              ) : null}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    collapsed={collapsed}
                    onNavigate={closeMobile}
                    renderLink={renderLink}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {sidebarFooter ? (
          <div
            className={cx(
              'shrink-0 border-t border-slate-200',
              collapsed ? 'flex justify-center p-2' : 'p-3',
            )}
          >
            {sidebarFooter}
          </div>
        ) : null}
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
            className="-ml-1 inline-flex size-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 lg:hidden"
          >
            <svg
              viewBox="0 0 20 20"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
            >
              <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
            </svg>
          </button>

          <button
            type="button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
            className="hidden size-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 lg:inline-flex"
          >
            <svg
              viewBox="0 0 20 20"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
            >
              <path
                d={collapsed ? 'M8 5l5 5-5 5' : 'M12 5l-5 5 5 5'}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <div className="min-w-0 flex-1">{topbar}</div>
        </header>

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
