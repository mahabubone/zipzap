import { Outlet, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/app/settlements')({
  component: SettlementsLayout,
});

/**
 * Layout for everything under /app/settlements.
 *
 * This route used to BE the list, which meant it had a child it never rendered: a route that draws
 * its own page has to draw an `<Outlet />` for its children to appear, and without one the
 * statement link changed the URL and went on showing the list. The list is now
 * `settlements.index.tsx`; this file is only the frame.
 *
 * ponytail: no layout of its own — a heading here would repeat on the statement. Add one when a
 * second child needs it.
 */
function SettlementsLayout() {
  return <Outlet />;
}
