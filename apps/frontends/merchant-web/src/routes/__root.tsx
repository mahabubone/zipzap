import { HeadContent, Link, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import { Button, NotFound, RouteError } from '@zipzap/ui';
import '@zipzap/ui/styles.css';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'ZipZap' },
    ],
  }),
  /**
   * Both of these rendered the router's own default until now.
   *
   * An unmatched URL — a mistyped path, a stale campaign link, a bookmark from before a rename — gave
   * a visitor an unstyled development page in the middle of a branded product, and an uncaught loader
   * throw gave them TanStack's bare error screen. Both look like a crash, and both are the moment a
   * visitor decides whether this thing is trustworthy.
   *
   * `reset` is passed through on purpose: the error screen offers a retry only when there is a failed
   * load to re-run, and a button that reloads nothing is a promise the screen cannot keep.
   */
  notFoundComponent: () => (
    <NotFound
      subject="that page"
      description="The link may be out of date. Everything else in the console is where you left it."
      action={
        <Button asChild>
          <Link to="/">Back to the start</Link>
        </Button>
      }
    />
  ),
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} reset={reset} title="This page could not load" />
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
