import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
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
