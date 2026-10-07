import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AppShell, Button } from '@zipzap/ui';
import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api.ts';
import { clearSession, readSession } from '../lib/session.ts';

export const Route = createFileRoute('/app')({
  component: App,
});

function App() {
  const navigate = useNavigate();
  const [me, setMe] = useState<string>('');

  useEffect(() => {
    if (!readSession()) void navigate({ to: '/login' });
    apiClient()
      .getMe()
      .then((principal) => setMe(JSON.stringify(principal, null, 2)))
      .catch((e: unknown) => setMe(e instanceof Error ? e.message : 'Unauthorized'));
  }, [navigate]);

  async function logout() {
    try {
      await apiClient().logout();
    } finally {
      clearSession();
      void navigate({ to: '/login' });
    }
  }

  return (
    <AppShell
      brand="ZipZap"
      nav={[{ items: [{ label: 'Console', href: '/app', active: true }] }]}
      topbar={
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={logout}>
            Sign out
          </Button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-slate-500">Your principal, straight from the API.</p>
      <pre className="overflow-auto rounded-lg border border-slate-200 bg-white p-4 text-xs">
        {me || 'Loading…'}
      </pre>
    </AppShell>
  );
}
