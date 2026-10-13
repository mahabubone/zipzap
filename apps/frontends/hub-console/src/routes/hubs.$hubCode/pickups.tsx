import { createFileRoute, useParams } from '@tanstack/react-router';

function PickupsPage() {
  const { hubCode } = useParams({ from: '/hubs/$hubCode/pickups' });

  return (
    <div className="px-6 py-5">
      <h2 className="mb-6 text-2xl font-bold">Pickups</h2>
      <div className="rounded border border-slate-200 bg-white p-6">
        <p className="text-slate-600">Incoming shipments waiting for pickup at {hubCode}</p>
        <p className="mt-4 text-sm text-slate-500">
          View merchant orders, schedule pickups, and manage inbound logistics.
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/hubs/$hubCode/pickups')({
  component: PickupsPage,
});
