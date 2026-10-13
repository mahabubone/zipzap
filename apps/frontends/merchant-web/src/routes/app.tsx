import {
  Link,
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { withRequestContext } from '../lib/request-context.ts';
import { AppShell, type NavGroup, type NavLinkRender } from '@zipzap/ui';
import { apiClient } from '../lib/api.ts';
import { Logo } from '../lib/brand.tsx';
import { UserIdentity } from '../lib/user-identity.tsx';

/**
 * Resolves the principal on the SERVER, from the request context the global middleware captured.
 *
 * The cookie is `HttpOnly`, so it cannot be read by script — which is exactly why this has to run
 * on the server: a client-side check would be asking the browser about a cookie the browser is not
 * allowed to disclose. `withRequestContext` carries the header across the boundary, and the client
 * resolves its relative `/api` base URL against the origin the request arrived on.
 */
/**
 * Resolves the principal on the SERVER, from the context the middleware captured.
 */
const loadPrincipal = createServerFn({ method: 'GET' })
  .middleware([withRequestContext])
  .handler(async ({ context }) => {
    const client = apiClient({
      onRequest: (url, init) => {
        const absolute = new URL(url, context.origin);
        const headers = new Headers(init.headers as HeadersInit | undefined);
        if (context.cookie) headers.set('cookie', context.cookie);
        return { ...init, url: absolute.toString(), headers };
      },
    });
    return client.getMe();
  });

export const Route = createFileRoute('/app')({
  /**
   * The guard, on the server.
   *
   * It used to be a `useEffect` in the layout, which meant `/app/shipments` was rendered, shipped,
   * hydrated and then redirected — a full page of console flashed at an unauthenticated visitor
   * before the check ran. `beforeLoad` runs before any component renders, so a `redirect()` thrown
   * here is a redirect with no flash and no fetch the browser had to make first.
   *
   * `redirect` rather than a thrown `Error`: TanStack Router treats a thrown `redirect()` as a
   * navigation, and treats any other throw as an error boundary — which would render an error page
   * where a login form belongs.
   */
  beforeLoad: async () => {
    try {
      return { principal: await loadPrincipal() };
    } catch {
      // The cookie is missing, expired or revoked.
      //
      // It is not cleared here, and cannot be: it is `HttpOnly`, so no code on this page can touch
      // it, and `logout` refuses a request that arrives without a valid session. A cookie with a
      // past expiry dies on the browser's own clock; a revoked one stops being honoured the moment
      // the server revokes it. Either way the next `login` replaces it.
      throw redirect({ to: '/login' });
    }
  },
  component: ConsoleLayout,
});

/**
 * One place decides which nav item is lit, so a new screen only adds a link.
 *
 * The first item was labelled "Control tower", which is also the name of a separate application on
 * a separate port — the operations manager's network map. Two different screens answering to one
 * name is how a screenshot of the merchant dashboard ends up filed as `ops_network_map`, and it
 * tells a merchant looking for their parcels that they are somewhere else. This one is the
 * merchant's own overview, so it says so.
 */
const LINKS = [
  { label: 'Overview', href: '/app' },
  { label: 'Shipments', href: '/app/shipments' },
  { label: 'New shipment', href: '/app/shipments/new' },
  { label: 'Bulk import', href: '/app/shipments/bulk' },
  { label: 'Analytics', href: '/app/analytics' },
  { label: 'Money', href: '/app/money' },
  { label: 'Reconciliation', href: '/app/cod' },
  { label: 'Settlements', href: '/app/settlements' },
  { label: 'Rate card', href: '/app/pricing' },
  { label: 'Webhooks', href: '/app/webhooks' },
  { label: 'Notifications', href: '/app/notifications' },
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
  // Resolved on the server by `beforeLoad` and handed down as route context. Present by the time
  // anything renders, so there is no "loading the principal" state to show and no window in which
  // a screen reads a principal that turns out not to exist.
  const { principal } = Route.useRouteContext();

  async function logout() {
    try {
      // Revokes server-side and clears the cookie. Without the cleartext the browser would keep
      // sending a token the server has already refused.
      await apiClient().logout();
    } finally {
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
        <UserIdentity
          displayName={principal.displayName}
          email={principal.email}
          kind={principal.kind}
          onSignOut={logout}
        />
      }
    >
      <Outlet />
    </AppShell>
  );
}
