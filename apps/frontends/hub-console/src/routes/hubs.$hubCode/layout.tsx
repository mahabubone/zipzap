import { Outlet, useParams, useNavigate, useLocation } from '@tanstack/react-router';
import { Button, ErrorState } from '@zipzap/ui';
import { apiClient } from '../../lib/api.ts';
import { useAsync } from '@zipzap/web-kit';

export function HubLayout() {
  const { hubCode } = useParams({ from: '/hubs/$hubCode' });
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * The parcel list, fetched once here for the header's hub name and reused by the pages below.
   *
   * The error was being dropped: `workList.data?.hub.name ?? hubCode` falls back to the code, so a
   * failed load rendered the whole shell as though it were healthy — an operator would see
   * "DAC-D" in the header and a page full of zeros, and read that as "my hub is empty" rather than
   * "the request failed". So a failure of this fetch now shows the failure, with a way to try again.
   */
  const workList = useAsync(() => apiClient().hubParcels(hubCode), hubCode);

  /**
   * The six destinations, in an operator's order.
   *
   * `built: false` marks the three that are designed but empty. They are listed because removing
   * them would make the sidebar lie about what the console can do, and because a depot that asks
   * for riders will ask next week — but they say so, in the item, rather than opening onto a
   * paragraph describing a feature that does not exist.
   *
   * Positive for the reason the marker needs it: the condition reads `{!item.built && …}`. Written as
   * `shipped: false` with a `{item.shipped ? … : null}` check, it renders nothing at all — the three
   * items are marked unshipped and then the marker tests the opposite of what its name says.
   */
  const navItems: ReadonlyArray<{ label: string; path: string; built?: boolean }> = [
    { label: 'Overview', path: `/hubs/${hubCode}`, built: true },
    { label: 'Work (Scan)', path: `/hubs/${hubCode}/work`, built: true },
    { label: 'Riders', path: `/hubs/${hubCode}/riders`, built: false },
    { label: 'Deliveries', path: `/hubs/${hubCode}/deliveries`, built: false },
    { label: 'Pickups', path: `/hubs/${hubCode}/pickups`, built: false },
    { label: 'Manifests', path: `/manifests`, built: true },
  ];

  const isActive = (path: string) => location.pathname === path;

  async function signOut() {
    try {
      await apiClient().logout();
    } finally {
      void navigate({ to: '/login' });
    }
  }

  // The header is the one thing on this screen that cannot work without the parcel list, so its
  // failure replaces the page rather than being papered over with the hub code.
  if (workList.error) {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
            <div>
              <h1 className="text-lg font-semibold">{hubCode}</h1>
              <p className="text-sm text-slate-500">Hub Operations Dashboard</p>
            </div>
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </header>
        <main className="flex-1 px-6 py-8">
          <ErrorState message={workList.error} retry={workList.reload} />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold">{workList.data?.hub.name ?? hubCode}</h1>
            <p className="text-sm text-slate-500">Hub Operations Dashboard</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={workList.reload}>
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/*
          The nav is a list of routes, so it says `nav` — the hub console is the only app here that
          ships its own sidebar, and an unlabelled landmark here is indistinguishable from the
          main content to a screen reader.

          `aria-current` rather than colour alone: the active item was `bg-blue-100 text-blue-900`
          and nothing else, so the page you are on was announced to nobody.
        */}
        <nav
          aria-label="Hub sections"
          className="w-48 border-r border-slate-200 bg-slate-50 px-3 py-4"
        >
          <ul className="space-y-1">
            {navItems.map((item) => (
              <li key={item.path}>
                <button
                  onClick={() => navigate({ to: item.path })}
                  aria-current={isActive(item.path) ? 'page' : undefined}
                  className={`w-full rounded px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                    isActive(item.path)
                      ? 'bg-blue-100 text-blue-900'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {item.label}
                  {!item.built ? (
                    <span className="ml-1 text-xs font-normal text-slate-400">· soon</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
