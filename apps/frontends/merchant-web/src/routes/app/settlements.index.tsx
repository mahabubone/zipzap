import { createFileRoute, Link } from '@tanstack/react-router';
import { Button, ErrorState, MoneyText, PageHeader, Skeleton } from '@zipzap/ui';
import { apiClient } from '../../lib/api.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { formatWhen } from '../../lib/format.ts';

export const Route = createFileRoute('/app/settlements/')({
  component: SettlementsScreen,
});

/**
 * Settlements, and the statement behind each one.
 *
 * The exit check for this screen is "a statement downloads and its totals match what the screen
 * showed", and the screen half of that is this table: `frozenNetMinor` is displayed as the number,
 * and the CSV writes the same `netMinor` from the same server-side statement. There is no client
 * arithmetic here to drift.
 *
 * Download is a Blob rather than a link, because the CSV endpoint needs the Authorization header
 * and a plain `<a href>` cannot carry one — the browser would save the login page instead.
 */

const STATUS_TEXT: Readonly<Record<string, string>> = {
  CREATED: 'Awaiting approval',
  APPROVED: 'Approved',
  PAYMENT_INITIATED: 'Payment sent',
  PAYMENT_CONFIRMED: 'Payment confirmed',
  SETTLED: 'Paid out',
};

function SettlementsScreen() {
  const settlements = useAsync(() => apiClient().settlements({ limit: '25' }));
  const errors = useAsync(() => apiClient().codExceptions({ limit: '1' }));

  async function download(id: string, reference: string): Promise<void> {
    const csv = await apiClient().statementCsv(id);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `zipzap-${reference}.csv`;
    anchor.click();
    // Revoked immediately: a Blob URL pins its blob in memory until the document unloads, and a
    // merchant downloading forty statements would hold forty of them.
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settlements"
        description="Each row froze a set of collections at a figure. The statement shows what went in."
        actions={
          <button
            type="button"
            onClick={settlements.reload}
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            Refresh
          </button>
        }
      />

      {settlements.error ? (
        <ErrorState message={settlements.error} retry={settlements.reload} />
      ) : !settlements.data ? (
        <Skeleton className="h-40 w-full" />
      ) : settlements.data.data.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center">
          <p className="font-medium text-slate-900">No settlements yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">
            One is created once your collections are ready to be paid out.
          </p>
          <Link to="/app/money" className="mt-4 inline-block text-sm underline">
            See what you are owed
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Reference
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Created
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Amount
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  <span className="sr-only">Statement</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {settlements.data.data.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <Link
                      to="/app/settlements/$id"
                      params={{ id: row.id }}
                      className="font-mono text-slate-900 underline"
                    >
                      {row.reference}
                    </Link>
                  </th>
                  <td className="px-4 py-3 text-slate-600">
                    {STATUS_TEXT[row.status] ?? row.status}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatWhen(row.createdAt)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">
                    <MoneyText amountMinor={row.frozenNetMinor} currency={row.currency} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void download(row.id, row.reference)}
                    >
                      Download
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {errors.data && errors.data.data.length > 0 ? (
        <p className="text-sm text-slate-600">
          Your newest settlement is not the whole picture:{' '}
          <Link to="/app/cod" className="underline">
            {errors.data.data.length}{' '}
            {errors.data.data.length === 1 ? 'collection needs' : 'collections need'} review
          </Link>{' '}
          before the next one can be paid.
        </p>
      ) : null}
    </div>
  );
}
