import { createFileRoute } from '@tanstack/react-router';
import { ErrorState, KpiRow, MoneyText, PageHeader, Skeleton } from '@zipzap/ui';
import { apiClient } from '../../lib/api.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { formatWhen, minorOf } from '../../lib/format.ts';

export const Route = createFileRoute('/app/')({
  component: ControlTower,
});

function ControlTower() {
  const counts = useAsync(() => apiClient().liveCounts());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Control tower"
        description="One snapshot of the whole network, taken server-side."
        actions={
          <button
            type="button"
            onClick={counts.reload}
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            Refresh
          </button>
        }
      />

      {counts.error ? (
        <ErrorState message={counts.error} retry={counts.reload} />
      ) : !counts.data ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          <KpiRow
            columns={4}
            items={[
              { label: 'Shipments today', value: counts.data.shipments.todayNew },
              { label: 'In transit', value: counts.data.shipments.inTransit },
              { label: 'Out for delivery', value: counts.data.shipments.outForDelivery },
              { label: 'Delivered', value: counts.data.shipments.delivered },
            ]}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Exceptions" hint="Needs an operator">
              <Rows
                rows={[
                  ['Failed deliveries', counts.data.shipments.failed],
                  ['Lost or damaged', counts.data.shipments.lostOrDamaged],
                  ['On hold', counts.data.shipments.onHold],
                  ['Returned', counts.data.shipments.returned],
                ]}
              />
            </Panel>

            <Panel title="Cash on delivery" hint="Poisha, integer minor units">
              <div className="flex items-baseline gap-3">
                <MoneyText
                  amountMinor={minorOf(counts.data.cod.outstandingAmountMinor)}
                  currency="BDT"
                  className="text-2xl font-semibold text-slate-900"
                />
                <span className="text-sm text-slate-500">
                  across {counts.data.cod.outstanding} uncollected parcels
                </span>
              </div>
              <Rows
                className="mt-4"
                rows={[
                  ['Expected', counts.data.cod.expected],
                  ['Collected', counts.data.cod.byStatus.COD_COLLECTED ?? 0],
                  ['Reconciled', counts.data.cod.byStatus.COD_RECONCILED ?? 0],
                  ['Settled', counts.data.cod.byStatus.SETTLED ?? 0],
                ]}
              />
            </Panel>

            <Panel title="Riders" hint="Online and available now">
              <Rows
                rows={[
                  ['Online', counts.data.riders.online],
                  ['Available', counts.data.riders.available],
                  ['On a delivery', counts.data.riders.byStatus.ON_DELIVERY ?? 0],
                  ['Suspended', counts.data.riders.suspended],
                ]}
              />
            </Panel>

            <Panel title="Network" hint="Hubs and backlog">
              <Rows
                rows={[
                  ['Hubs', counts.data.hub.networkHubs],
                  ['Hub backlog', counts.data.hub.backlog],
                  ['Pickups active', counts.data.pickups.active],
                  ['Pickups pending', counts.data.pickups.pending],
                ]}
              />
            </Panel>
          </div>

          <p className="text-xs text-slate-400">
            Snapshot taken {formatWhen(counts.data.timestamp)} (Asia/Dhaka)
          </p>
        </>
      )}
    </div>
  );
}

function Panel({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        <span className="text-xs text-slate-400">{hint}</span>
      </div>
      {children}
    </section>
  );
}

function Rows({
  rows,
  className = '',
}: {
  readonly rows: ReadonlyArray<readonly [string, number]>;
  readonly className?: string;
}) {
  return (
    <dl className={`flex flex-col gap-2 ${className}`}>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 text-sm">
          <dt className="text-slate-600">{label}</dt>
          <dd className="font-medium tabular-nums text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
