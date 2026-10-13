import { createFileRoute, Link } from '@tanstack/react-router';
import { ErrorState, PageHeader, Skeleton } from '@zipzap/ui';
import { apiClient } from '../../lib/api.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { formatMinor, formatWhen } from '../../lib/format.ts';
import { exceptionLine } from '../../lib/money.ts';

export const Route = createFileRoute('/app/cod')({
  component: CodQueue,
});

/**
 * The reconciliation queue.
 *
 * The plan calls this the strongest correctness story in the product and the reason no competitor
 * has it is worth stating plainly: **there was nowhere to see an exception.** Ops could page through
 * every COD record ever created to find the three that were wrong. A control nobody can see is not
 * a control.
 *
 * Each row shows the disagreement, not just a status. "1 parcel needs review" is a queue entry;
 * "you were promised ৳1,250.50, your rider handed back ৳1,255.00" is a decision somebody can make.
 */
function CodQueue() {
  const queue = useAsync(() => apiClient().codExceptions({ limit: '50' }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reconciliation queue"
        description="Collections where the cash handed back did not match the amount quoted. Each one holds up your payout until it is reviewed."
        actions={
          <button
            type="button"
            onClick={queue.reload}
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            Refresh
          </button>
        }
      />

      {queue.error ? (
        <ErrorState message={queue.error} retry={queue.reload} />
      ) : !queue.data ? (
        <Skeleton className="h-40 w-full" />
      ) : queue.data.data.length === 0 ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-6 py-10 text-center">
          <p className="font-medium text-emerald-900">Nothing needs reviewing</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-emerald-800">
            Every collection matched the amount it was quoted. Nothing is holding up your payout.
          </p>
          <Link to="/app/money" className="mt-4 inline-block text-sm underline">
            Back to your balance
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Parcel
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Quoted
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Collected
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Difference
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  When
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {queue.data.data.map((item) => {
                const line = exceptionLine(item);
                return (
                  <tr key={item.id}>
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      <Link
                        to="/app/shipments/$id"
                        params={{ id: item.shipmentId }}
                        className="font-mono text-slate-900 underline"
                      >
                        {item.shipmentId.slice(0, 8)}
                      </Link>
                      <span className="ml-2 text-xs text-slate-500">{line.verdict}</span>
                    </th>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                      {formatMinor(item.expectedMinor, item.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">
                      {item.collectedMinor === null
                        ? '—'
                        : formatMinor(item.collectedMinor, item.currency)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono font-medium tabular-nums ${
                        item.differenceMinor > 0 ? 'text-red-700' : 'text-amber-700'
                      }`}
                    >
                      {line.signed}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatWhen(item.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
