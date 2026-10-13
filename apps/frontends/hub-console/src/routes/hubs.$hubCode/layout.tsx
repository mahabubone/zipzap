import { Outlet, useParams, useNavigate, useLocation } from '@tanstack/react-router';
import { Button } from '@zipzap/ui';
import { apiClient } from '../../lib/api.ts';
import { useAsync } from '@zipzap/web-kit';

export function HubLayout() {
  const { hubCode } = useParams({ from: '/hubs/$hubCode' });
  const navigate = useNavigate();
  const location = useLocation();

  const workList = useAsync(() => apiClient().hubParcels(hubCode), hubCode);

  const navItems = [
    { label: 'Overview', path: `/hubs/${hubCode}` },
    { label: 'Work (Scan)', path: `/hubs/${hubCode}/work` },
    { label: 'Riders', path: `/hubs/${hubCode}/riders` },
    { label: 'Deliveries', path: `/hubs/${hubCode}/deliveries` },
    { label: 'Pickups', path: `/hubs/${hubCode}/pickups` },
    { label: 'Manifests', path: `/manifests` },
  ];

  const isActive = (path: string) => location.pathname === path;

  async function signOut() {
    try {
      await apiClient().logout();
    } finally {
      void navigate({ to: '/login' });
    }
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
        {/* Sidebar Navigation */}
        <nav className="w-48 border-r border-slate-200 bg-slate-50 px-3 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => (
              <li key={item.path}>
                <button
                  onClick={() => navigate({ to: item.path })}
                  className={`w-full rounded px-3 py-2 text-left text-sm font-medium transition-colors ${
                    isActive(item.path)
                      ? 'bg-blue-100 text-blue-900'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {item.label}
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
