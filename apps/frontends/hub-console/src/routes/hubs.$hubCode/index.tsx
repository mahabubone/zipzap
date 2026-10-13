import { createFileRoute, Link } from '@tanstack/react-router';
import { useParams } from '@tanstack/react-router';
import { Spinner, ErrorState, StatCard } from '@zipzap/ui';
import { apiClient } from '../../lib/api.ts';
import { formatWhen, useAsync } from '@zipzap/web-kit';

function OverviewPage() {
  const { hubCode } = useParams({ from: '/hubs/$hubCode' });
  const workList = useAsync(() => apiClient().hubParcels(hubCode), hubCode);

  if (workList.loading) return <Spinner />;
  // `retry` because this screen is four counts and a list, and an operator whose network dropped
  // mid-shift should not have to reload the tab to see the belt again.
  if (workList.error) {
    return <ErrorState message={workList.error} retry={workList.reload} />;
  }

  const data = workList.data!;
  const parcels = data.parcels ?? [];

  const stats = [
    { label: 'Parcels Waiting', value: String(parcels.length) },
    {
      label: 'Ready to Pickup',
      value: String(parcels.filter((p) => p.nextScan === 'INBOUND_RECEIVE').length),
    },
    {
      label: 'Ready to Outbound',
      value: String(parcels.filter((p) => p.nextScan === 'OUTBOUND').length),
    },
    {
      label: 'Ready to Sort',
      value: String(parcels.filter((p) => p.nextScan === 'SORT').length),
    },
  ];

  return (
    <div className="p-6">
      <h2 className="mb-6 text-2xl font-bold">Operations Overview</h2>

      {/* Key Metrics */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>

      {/* Hub Info */}
      <div className="rounded border border-slate-200 bg-white p-6">
        <h3 className="font-semibold text-slate-900">Hub Status</h3>
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-slate-600">Hub Code</p>
            <p className="font-mono font-semibold">{data.hub.code}</p>
          </div>
          <div>
            <p className="text-slate-600">Hub Name</p>
            <p className="font-semibold">{data.hub.name}</p>
          </div>
          <div>
            <p className="text-slate-600">Total Parcels</p>
            <p className="font-semibold">{parcels.length}</p>
          </div>
          <div>
            <p className="text-slate-600">Snapshot taken</p>
            {/* The instant the data was fetched, not the instant this component rendered.
                `new Date()` in render position answers "when did the browser paint", so the number
                said the screen was fresh when what it described could be a minute old — and it moved
                on every re-render, so a number that claimed to be a timestamp was in fact a clock. */}
            <p className="font-semibold text-xs">{formatWhen(data.timestamp)}</p>
            <p className="text-xs text-slate-400">Asia/Dhaka</p>
          </div>
        </div>
      </div>

      {/*
        Quick actions that actually go somewhere.

        These were two `div`s with `cursor-pointer` and no handler at all — the screen looked
        tappable, said "Start Scanning", and did nothing. An affordance that lies is worse than an
        absent one, because the operator learns to distrust the whole panel. Now they are links, so
        they are reachable by keyboard, they show a focus ring, and they cannot be clicked without
        navigating.
      */}
      <div className="mt-8">
        <h3 className="mb-4 font-semibold text-slate-900">Quick Actions</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            to="/hubs/$hubCode/work"
            params={{ hubCode }}
            className="rounded border-2 border-dashed border-slate-300 p-6 text-center transition-colors hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <p className="text-lg font-semibold text-slate-700">Start Scanning</p>
            <p className="mt-1 text-sm text-slate-500">Begin parcel processing</p>
          </Link>
          <Link
            to="/hubs/$hubCode/riders"
            params={{ hubCode }}
            className="rounded border-2 border-dashed border-slate-300 p-6 text-center transition-colors hover:border-purple-400 hover:bg-purple-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <p className="text-lg font-semibold text-slate-700">View Riders</p>
            <p className="mt-1 text-sm text-slate-500">Manage assignments and positions</p>
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/hubs/$hubCode/')({
  component: OverviewPage,
});
