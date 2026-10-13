import { HeadContent, Link, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import { Button, NotFound, RouteError } from '@zipzap/ui';
import '@zipzap/ui/styles.css';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Track your parcel — ZipZap' },
      { name: 'description', content: 'Track a ZipZap parcel with its tracking code.' },
      // A recipient gets here from an SMS or an email. Never let a search engine
      // or a chat preview cache a stale status under a shared link.
      { name: 'robots', content: 'noindex' },
    ],
  }),
  /**
   * This is the app a recipient reaches from a text message, on a phone, often on a bad connection —
   * and it is the app most likely to be opened with the wrong path, because a code is typed by hand
   * and autocorrect is enthusiastic. A router default here is an unstyled page with a path on it,
   * which on a phone reads as a phishing warning.
   *
   * So the miss says what a tracking code looks like and offers the form, which is the only thing a
   * person who mistyped one actually wants.
   */
  notFoundComponent: () => (
    <NotFound
      subject="that page"
      description="A tracking link looks like this one. If you have the code, you can look it up below."
      action={
        <Button asChild>
          <Link to="/track">Enter a tracking code</Link>
        </Button>
      }
    />
  ),
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} reset={reset} title="This parcel could not load" />
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
