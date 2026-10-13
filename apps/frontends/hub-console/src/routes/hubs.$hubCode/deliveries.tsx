import { createFileRoute, useParams } from '@tanstack/react-router';
import { EmptyState } from '@zipzap/ui';

/**
 * A destination that is designed and not yet built.
 *
 * See `riders.tsx` for why this says "not built yet" instead of describing a feature that does not
 * exist. What a caller can rely on is the shape: a hub code in, an honest screen out.
 */
function NotShipped({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-6 py-5">
      <h2 className="mb-6 text-2xl font-bold">{title}</h2>
      <EmptyState
        title="Not built yet"
        description={`${description} This screen is designed and wired into the navigation, but there is nothing behind it yet.`}
      />
    </div>
  );
}

function DeliveriesPage() {
  const { hubCode } = useParams({ from: '/hubs/$hubCode/deliveries' });
  return (
    <NotShipped
      title="Deliveries"
      description={`Last-mile deliveries leaving ${hubCode}, with the COD each one collects.`}
    />
  );
}

export const Route = createFileRoute('/hubs/$hubCode/deliveries')({
  component: DeliveriesPage,
});
