import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
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
