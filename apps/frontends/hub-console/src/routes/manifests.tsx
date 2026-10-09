import { Outlet } from '@tanstack/react-router';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Logo } from '../lib/brand.tsx';

export const Route = createFileRoute('/manifests')({
  component: ManifestsLayout,
});

/**
 * Frame for the manifest list and the manifest detail.
 *
 * Only the frame. A parent route that renders its own page must also render an `<Outlet />` or its
 * children never appear — the same trap `settlements.tsx` documents, where a statement link changed
 * the URL and went on rendering the list.
 *
 * ponytail: no heading of its own. The list and the detail each render their own, and a second one
 * here would repeat on both. Add one when a third child needs it.
 */
function ManifestsLayout() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <Logo className="size-8" />
            <span className="font-semibold">Manifests</span>
          </Link>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
