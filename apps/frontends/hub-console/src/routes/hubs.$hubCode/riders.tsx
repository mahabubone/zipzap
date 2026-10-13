import { createFileRoute, useParams } from '@tanstack/react-router';
import { EmptyState } from '@zipzap/ui';

/**
 * A destination that is designed and not yet built.
 *
 * Three of the six sidebar items land here — riders, deliveries, pickups — and until this commit
 * each one rendered a heading and a sentence describing the feature it did not have. An operator
 * clicking "Deliveries" at a depot expects to see deliveries; showing them a paragraph about them
 * is a worse answer than saying so plainly, because the first one teaches them the console is
 * unreliable.
 *
 * So it says so, on the screen, in the same words as the sidebar. The route is kept because the
 * information architecture is settled and a depot will ask for it; what is missing is the data, not
 * the decision about where it goes.
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

function RidersPage() {
  const { hubCode } = useParams({ from: '/hubs/$hubCode/riders' });
  return (
    <NotShipped
      title="Rider management"
      description={`Riders assigned to ${hubCode}, their positions and their assignments.`}
    />
  );
}

export const Route = createFileRoute('/hubs/$hubCode/riders')({
  component: RidersPage,
});
