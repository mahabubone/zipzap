import { createFileRoute, Link } from '@tanstack/react-router';
import { Button, ErrorState, MoneyText, PageHeader, Skeleton } from '@zipzap/ui';
import { apiClient } from '../../lib/api.ts';
import { useAsync } from '@zipzap/web-kit';
import { formatMinor, formatWhen } from '@zipzap/web-kit';
import { balanceHeadline, balanceRows, needsReview } from '../../lib/money.ts';

export const Route = createFileRoute('/app/money')({
  component: MoneyScreen,
});

/**
 * The money screen: one number, then everything needed to argue with it.
 *
 * The plan asks for "you are owed ৳X, arriving Y" — not outstanding/collected/pending/received as
 * four figures. Four numbers invite the reader to add them up and get something we never promised,
 * so the headline is the only number here and every other row on the page exists to explain it.
 *
 * The blocked banner is the reason this screen is more than a receipt. A mismatch that nobody has
 * reviewed holds up the whole payout, and a merchant who cannot see that will assume the money is
 * simply late — which is exactly the belief the plan calls "gap 1".
 */
function MoneyScreen() {
  const balance = useAsync(() => apiClient().balance());
  const rows = balance.data ? balanceRows(balance.data.lines) : [];
  const headline = balance.data
    ? balanceHeadline(balance.data.balanceMinor, balance.data.currency)
    : null;
  const review = balance.data ? needsReview(balance.data) : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Money"
        description="One figure, derived from your ledger, with everything that made it up."
        actions={
          <button
            type="button"
            onClick={balance.reload}
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            Refresh
          </button>
        }
      />

      {balance.error ? (
        <ErrorState message={balance.error} retry={balance.reload} />
      ) : !balance.data || !headline ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          <section className="rounded-lg border border-slate-200 bg-white p-6">
            <p className="text-sm text-slate-500">{headline.phrasing}</p>
            {/* aria-live: this figure changes on its own after a collection, and a screen-reader
                user refreshing the page should hear it without hunting for what moved. */}
            <p
              aria-live="polite"
              className="mt-1 text-4xl font-semibold tracking-tight text-slate-900"
            >
              <MoneyText amountMinor={balance.data.balanceMinor} currency={balance.data.currency} />
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {balance.data.nextSettlement ? (
                <>
                  {balance.data.nextSettlement.reference} is being processed for{' '}
                  {formatMinor(balance.data.nextSettlement.netMinor, balance.data.currency)}.
                </>
              ) : (
                'No settlement is in progress. New collections are paid on the next run.'
              )}{' '}
              As of {formatWhen(balance.data.asOf)}.
            </p>
          </section>

          {balance.data.blockedReason !== null ? (
            <section
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4"
            >
              <p className="font-medium text-amber-900">A payout is being held back</p>
              <p className="mt-1 text-sm text-amber-800">{balance.data.blockedReason}</p>
              {review > 0 ? (
                <p className="mt-2 text-sm text-amber-900">
                  {review} {review === 1 ? 'collection needs' : 'collections need'} a human review.{' '}
                  <Link to="/app/cod" className="underline">
                    Open the reconciliation queue
                  </Link>
                  .
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <caption className="px-4 py-3 text-left text-sm font-medium text-slate-900">
                What makes up this figure
              </caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Item
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className="px-4 py-2 text-left font-normal text-slate-700">
                      {row.label}
                      <span className="ml-2 text-xs text-slate-400">
                        {row.entries} {row.entries === 1 ? 'entry' : 'entries'}
                      </span>
                    </th>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-900">
                      {formatMinor(row.amountMinor, balance.data!.currency)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <th scope="row" className="px-4 py-2 text-left font-medium text-slate-900">
                    You are owed
                  </th>
                  <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums text-slate-900">
                    {headline.amount}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <div className="flex gap-3">
            <Link to="/app/settlements">
              <Button variant="secondary">Settlements and statements</Button>
            </Link>
            <Link to="/app/pricing">
              <Button variant="secondary">Rate card</Button>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
