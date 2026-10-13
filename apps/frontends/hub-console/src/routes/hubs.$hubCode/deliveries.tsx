import { createFileRoute, useParams } from '@tanstack/react-router';

function DeliveriesPage() {
  const { hubCode } = useParams({ from: '/hubs/$hubCode/deliveries' });

  return (
    <div className="px-6 py-5">
      <h2 className="mb-6 text-2xl font-bold">Deliveries</h2>
      <div className="rounded border border-slate-200 bg-white p-6">
        <p className="text-slate-600">Active and completed deliveries from {hubCode}</p>
        <p className="mt-4 text-sm text-slate-500">
          Track delivery status, COD collections, and last-mile updates in real time.
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/hubs/$hubCode/deliveries')({
  component: DeliveriesPage,
});
