import { createFileRoute, isRedirect, redirect, useNavigate } from '@tanstack/react-router';
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
  /**
   * Two outcomes, and the distinction between them is the point of the screen.
   *
   * Assigned a hub → go there. Assigned nothing → stay, and say so, because "not assigned" is a
   * state a hub manager can fix in thirty seconds and a login loop cannot be fixed at all.
   *
   * The redirect is thrown after the try for the same reason as in `index.tsx`: `redirect()` returns
   * a `Response`, so a catch that tests `e instanceof Error` cannot tell one from a failure, and
   * throws away the very navigation it was supposed to let through. `isRedirect` is the router's own
   * check and is used here for the case where the server function itself redirects.
   */
  beforeLoad: async () => {
    let hub: Awaited<ReturnType<typeof loadMyHub>>;
    try {
      hub = await loadMyHub();
    } catch (e) {
      if (isRedirect(e)) throw e;
      // The session is gone or unreadable — not "this person works nowhere". `loadMyHub` already
      // turns a 404 into `null`, because a 404 here means between hubs, which is a real answer.
      throw redirect({ to: '/login' });
    }
    if (hub) throw redirect({ to: '/hubs/$hubCode', params: { hubCode: hub.code } });
    return { hub: null };
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
