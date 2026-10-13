import { Outlet, createFileRoute } from '@tanstack/react-router';

/**
 * Layout for everything under /app/shipments.
 *
 * This route used to BE the list, which meant it had children it never rendered:
 * a route that renders its own page has to render an `<Outlet />` for its
 * children to appear, and without one `/app/shipments/new`, `/bulk` and `/$id`
 * all silently showed the list instead. The list now lives in
 * `shipments.index.tsx`; this file is only the frame.
 *
 * ponytail: no layout of its own — a heading or a toolbar here would have to be
 * repeated by every child. Add one when a second child needs it.
 */
export const Route = createFileRoute('/app/shipments')({
  component: ShipmentsLayout,
});

function ShipmentsLayout() {
  return <Outlet />;
}
