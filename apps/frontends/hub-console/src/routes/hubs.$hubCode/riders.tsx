import { createFileRoute, useParams } from '@tanstack/react-router';

function RidersPage() {
  const { hubCode } = useParams({ from: '/hubs/$hubCode/riders' });

  return (
    <div className="px-6 py-5">
      <h2 className="mb-6 text-2xl font-bold">Rider Management</h2>
      <div className="rounded border border-slate-200 bg-white p-6">
        <p className="text-slate-600">Riders assigned to {hubCode}</p>
        <p className="mt-4 text-sm text-slate-500">
          View and manage rider assignments, positions, and delivery status.
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/hubs/$hubCode/riders')({
  component: RidersPage,
});
