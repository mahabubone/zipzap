import { HeadContent, Link, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import { Button, NotFound, RouteError } from '@zipzap/ui';
import '@zipzap/ui/styles.css';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      // `viewport-fit=cover` plus `maximum-scale` is deliberate: a loading dock phone is held in
      // one hand and a pinch-zoom mid-scan is a dropped parcel. The cost is that a screen-reader
      // user cannot zoom — which is why every target here is already 48px and the type is large.
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: 'ZipZap Hub Console' },
    ],
  }),
  /**
   * A depot operator on a phone, standing at a belt, hitting a mistyped path. The router default is
   * an unstyled page; this one names the hub console and offers the screen they came for, which is
   * the one thing that matters when the parcel in your hand is waiting on it.
   */
  notFoundComponent: () => (
    <NotFound
      subject="that screen"
      description="The hub console has one work list. If a link pointed elsewhere, it is out of date."
      action={
        <Button asChild>
          <Link to="/my-hub">Back to my hub</Link>
        </Button>
      }
    />
  ),
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} reset={reset} title="This screen could not load" />
  ),
  component: () => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      {/* `bg-white` on a 5" screen under a warehouse light: a dark theme is a readability tax
          paid at the loading dock, and this app has exactly one user and one room. */}
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
