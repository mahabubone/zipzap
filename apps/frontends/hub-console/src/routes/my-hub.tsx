import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { withRequestContext } from '../lib/request-context.ts';
import { apiClient } from '../lib/api.ts';
import { ZipZapApiError } from '@zipzap/api-client';
import { Button, EmptyState } from '@zipzap/ui';
import { Logo } from '../lib/brand.tsx';

/**
 * Loads the caller's assigned hub on the server.
 * Returns a redirect to /hubs/:hubCode if assigned, or 404 if not.
 */
const loadMyHub = createServerFn({ method: 'GET' })
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
    try {
      return await client.myHub();
    } catch (e) {
      // Check if it's a 404 error (not assigned to a hub)
      if (e instanceof ZipZapApiError && e.status === 404) {
        return null;
      }
      throw e;
    }
  });

export const Route = createFileRoute('/my-hub')({
  beforeLoad: async () => {
    try {
      const hub = await loadMyHub();
      if (hub) {
        // Redirect to the assigned hub
        throw redirect({ to: '/hubs/$hubCode', params: { hubCode: hub.code } });
      }
      // Not assigned, show the "not assigned" screen
      return { hub: null };
    } catch (e) {
      // If it's a redirect, rethrow it
      if (e instanceof Error && 'isRedirect' in e) throw e;
      // Otherwise it's an auth or network error
      throw redirect({ to: '/login' });
    }
  },
  component: MyHubScreen,
});

function MyHubScreen() {
  const navigate = useNavigate();

  async function signOut() {
    try {
      await apiClient().logout();
    } finally {
      void navigate({ to: '/login' });
    }
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Logo className="size-8" />
            <span className="font-semibold">Hub console</span>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <EmptyState
          title="Not assigned to a hub"
          description="You are not currently assigned to any hub. Please contact your manager to be assigned."
        />
      </main>
    </div>
  );
}
