import { createFileRoute, Link } from '@tanstack/react-router';
import { ErrorState, KpiRow, MoneyText, PageHeader, Skeleton } from '@zipzap/ui';
import { apiClient } from '../../lib/api.ts';
import { formatWhen, statusLabel, useAsync } from '@zipzap/web-kit';

export const Route = createFileRoute('/app/')({
  component: Overview,
});

/**
 * The merchant's overview: their parcels, and the cash attached to them.
 *
 * This screen used to be titled "Control tower" and rendered `GET /v1/control-tower/live-counts` —
 * the network's own picture: every merchant's parcels, every hub, every rider. It was called
 * "Control tower" because it was a copy of the operations screen, and it answered **403** to the one
 * person who is meant to see it, because `live-counts` is `network:read` on purpose (see
 * `common/scopes.ts`). So the console's landing page was an error box, which is why the shots
 * pipeline photographed it as the operations manager instead of as a merchant.
 *
 * What replaced it is narrower and more useful: `GET /v1/shipments/counts` is the same aggregate
 * with the tenancy predicate on, so these are this merchant's parcels and nothing else, and the money
 * panel is their own derived balance rather than the network's outstanding COD.
 *
 * The labels live in `@zipzap/web-kit`, because this screen and the hub console read the same status
 * enum and used to word it differently.
 */
function Overview() {
  const counts = useAsync(() => apiClient().shipmentCounts());
  const balance = useAsync(() => apiClient().balance());
  const exceptions = useAsync(() => apiClient().codExceptions({ limit: '5' }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="Your parcels right now, and what you are owed for them."
        actions={
          <button
            type="button"
            onClick={() => {
              counts.reload();
              balance.reload();
            }}
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
              { label: 'Created today', value: counts.data.todayNew },
              { label: 'In transit', value: countIn(counts.data, 'IN_TRANSIT') },
              { label: 'Out for delivery', value: countIn(counts.data, 'OUT_FOR_DELIVERY') },
              { label: 'Delivered', value: countIn(counts.data, 'DELIVERED') },
            ]}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Where your parcels are" hint="Every status you have">
              <ul className="flex flex-col gap-1.5 text-sm">
                {activeStates(counts.data.byStatus).map(([status, count]) => (
                  <li key={status} className="flex items-center justify-between gap-3">
                    <Link
                      to="/app/shipments"
                      search={{ status }}
                      className="text-slate-600 underline-offset-2 hover:underline"
                    >
                      {statusLabel(status)}
                    </Link>
                    <span className="font-medium text-slate-900">{count}</span>
                  </li>
                ))}
                {activeStates(counts.data.byStatus).length === 0 ? (
                  <li className="text-slate-500">No parcels yet.</li>
                ) : null}
              </ul>
              <p className="mt-3 text-xs text-slate-400">
                Each number links to the filtered list it came from.
              </p>
            </Panel>

            <Panel title="Cash on delivery" hint="Derived from your ledger">
              {balance.error ? (
                <p role="status" className="text-sm text-amber-700">
                  {balance.error}
                </p>
              ) : !balance.data ? (
                <Skeleton className="h-12 w-full" />
              ) : (
                <div className="flex items-baseline gap-3">
                  <MoneyText
                    amountMinor={balance.data.balanceMinor}
                    currency="BDT"
                    className="text-2xl font-semibold text-slate-900"
                  />
                  <span className="text-sm text-slate-500">
                    {balance.data.balanceMinor < 0 ? 'owed to you' : 'you are owed'}
                  </span>
                  {balance.data.blockedReason ? (
                    <p role="status" className="mt-2 text-sm text-amber-700">
                      {balance.data.blockedReason}
                    </p>
                  ) : null}
                </div>
              )}
              <Link
                to="/app/money"
                className="mt-3 inline-block text-sm text-slate-600 underline underline-offset-2"
              >
                The lines that make up this figure
              </Link>
            </Panel>

            <Panel title="Needs review" hint="Cash that did not match its quote">
              {exceptions.error ? (
                // Said rather than hidden: this queue is what holds a settlement, so an absent warning
                // reads as "nothing is waiting" when it means "we could not check".
                <p role="status" className="text-sm text-amber-700">
                  We could not load the queue.{' '}
                  <Link to="/app/cod" className="underline">
                    Open reconciliation
                  </Link>
                  .
                </p>
              ) : !exceptions.data ? (
                <Skeleton className="h-10 w-full" />
              ) : exceptions.data.data.length === 0 ? (
                <p className="text-sm text-slate-600">
                  Nothing is waiting. Every collection matched the amount it was quoted.
                </p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {exceptions.data.data.map((exception) => (
                    <li key={exception.id} className="flex items-center justify-between gap-3">
                      <span className="truncate text-slate-600">
                        Collected {exception.collectedMinor ?? 0} of {exception.expectedMinor}{' '}
                        {exception.currency === 'BDT' ? 'poisha' : exception.currency}
                        {exception.reviewNote ? ` — ${exception.reviewNote}` : ''}
                      </span>
                      <MoneyText amountMinor={exception.differenceMinor} currency="BDT" />
                    </li>
                  ))}
                  <li>
                    <Link to="/app/cod" className="underline underline-offset-2">
                      Review all {exceptions.data.data.length} shown
                    </Link>
                  </li>
                </ul>
              )}
            </Panel>

            <Panel title="Shipments needing an operator" hint="Delivered, lost, damaged, held">
              <Rows
                rows={[
                  ['Delivered', countIn(counts.data, 'DELIVERED')],
                  ['Lost or damaged', sum(counts.data, 'LOST', 'DAMAGED')],
                  ['On hold', countIn(counts.data, 'ON_HOLD')],
                  ['Returned', countIn(counts.data, 'RETURNED')],
                ]}
              />
            </Panel>
          </div>

          <p className="text-xs text-slate-400">
            {counts.data.total} shipment{counts.data.total === 1 ? '' : 's'} in total, as of{' '}
            {formatWhen(counts.data.timestamp)} (Asia/Dhaka).
          </p>
        </>
      )}
    </div>
  );
}

/** One status's count. The map is complete, so a missing key would be a bug, not a zero. */
function countIn(counts: { byStatus: Record<string, number> }, status: string): number {
  return counts.byStatus[status] ?? 0;
}

function sum(counts: { byStatus: Record<string, number> }, ...statuses: string[]): number {
  return statuses.reduce((total, status) => total + countIn(counts, status), 0);
}

/**
 * The statuses worth showing, in the order a parcel actually passes through them.
 *
 * Not alphabetical, and not every status: a merchant reads this as "what is happening to my
 * parcels", so the answer is the states that mean something is happening. Terminal states are left
 * out of this list and shown in the summary panel instead, where they stop being a queue.
 */
const activeStates = (byStatus: Record<string, number>): Array<[string, number]> =>
  (
    [
      'CREATED',
      'PICKUP_REQUESTED',
      'PICKUP_ASSIGNED',
      'PICKED_UP',
      'AT_ORIGIN_HUB',
      'SORTING',
      'DISPATCHED',
      'IN_TRANSIT',
      'AT_DESTINATION_HUB',
      'OUT_FOR_DELIVERY',
    ] as const
  )
    .map((status): [string, number] => [status, byStatus[status] ?? 0])
    .filter(([, count]) => count > 0);

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
    <dl className={`flex flex-col gap-1.5 text-sm ${className}`}>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3">
          <dt className="text-slate-600">{label}</dt>
          <dd className="font-medium text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
