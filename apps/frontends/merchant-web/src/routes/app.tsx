import { Link, createFileRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { AppShell, Button, type NavGroup, type NavLinkRender } from '@zipzap/ui';
import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api.ts';
import { clearSession, readSession } from '../lib/session.ts';
import { Logo } from '../lib/brand.tsx';
import type { Principal } from '@zipzap/api-client';

export const Route = createFileRoute('/app')({
  component: ConsoleLayout,
});

/** One place decides which nav item is lit, so a new screen only adds a link. */
const LINKS = [
  { label: 'Control tower', href: '/app' },
  { label: 'Shipments', href: '/app/shipments' },
  { label: 'New shipment', href: '/app/shipments/new' },
  { label: 'Bulk import', href: '/app/shipments/bulk' },
  { label: 'Money', href: '/app/money' },
  { label: 'Reconciliation', href: '/app/cod' },
  { label: 'Settlements', href: '/app/settlements' },
  { label: 'Rate card', href: '/app/pricing' },
] as const;

function navFor(pathname: string): NavGroup[] {
  return [
    {
      label: 'Operate',
      items: LINKS.map((l) => ({
        ...l,
        // `/app` must not light up for `/app/shipments`, and `/app/shipments/new`
        // would light BOTH — so the longer path is matched exactly and only the
        // list uses a prefix test.
        active:
          l.href === '/app'
            ? pathname === '/app'
            : pathname === l.href || pathname.startsWith(`${l.href}/`),
      })),
    },
  ];
}

function ConsoleLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [principal, setPrincipal] = useState<Principal | null>(null);

  useEffect(() => {
    if (!readSession()) {
      void navigate({ to: '/login' });
      return;
    }
    apiClient()
      .getMe()
      .then(setPrincipal)
      .catch(() => {
        // Expired or revoked token — the session is worthless, so drop it.
        clearSession();
        void navigate({ to: '/login' });
      });
  }, [navigate]);

  async function logout() {
    try {
      await apiClient().logout();
    } finally {
      clearSession();
      void navigate({ to: '/login' });
    }
  }

  // The shell renders plain anchors; without this every nav click is a full
  // document reload and the console loses its session-scoped state.
  const renderLink: NavLinkRender = ({
    href,
    className,
    children,
    'aria-current': ariaCurrent,
    onNavigate,
  }) => (
    <Link to={href} className={className} aria-current={ariaCurrent} onClick={onNavigate}>
      {children}
    </Link>
  );

  return (
    <AppShell
      brand={<Logo />}
      nav={navFor(pathname)}
      renderLink={renderLink}
      sidebarFooter={
        principal ? (
          <div className="flex flex-col gap-2">
            <p className="truncate text-xs text-slate-500">{principal.subjectId}</p>
            <Button variant="secondary" size="sm" onClick={logout}>
              Sign out
            </Button>
          </div>
        ) : null
      }
    >
      <Outlet />
    </AppShell>
  );
}
