import { HeadContent, Link, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import { Button, NotFound, RouteError } from '@zipzap/ui';
import '@zipzap/ui/styles.css';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'ZipZap Control Tower' },
    ],
  }),
  /**
   * The control tower has exactly one screen, so a 404 here means a bookmark from before it was
   * simplified — and the person following it is an operations manager mid-shift. The router's default
   * is an unstyled page; this one says the screen moved and offers the board.
   */
  notFoundComponent: () => (
    <NotFound
      subject="that screen"
      description="The control tower is a single board. If a link pointed somewhere else, it is out of date."
      action={
        <Button asChild>
          <Link to="/">Back to the board</Link>
        </Button>
      }
    />
  ),
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} reset={reset} title="The board could not load" />
  ),
  component: () => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
