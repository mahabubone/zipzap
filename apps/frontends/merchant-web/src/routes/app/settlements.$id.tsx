import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Button, ErrorState, PageHeader, Skeleton } from '@zipzap/ui';
import { apiClient } from '../../lib/api.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { formatMinor, formatWhen } from '../../lib/format.ts';

export const Route = createFileRoute('/app/settlements/$id')({
  component: SettlementDetail,
});

/**
 * One settlement, itemised — and the download beside it.
 *
 * The total at the bottom is `statement.netMinor`, the same field the CSV's last row carries. It is
 * rendered, never recomputed: a client-side sum would be a second implementation of "the statement",
 * and two implementations is the failure the plan's exit check is written against.
 */

const STATUS_TEXT: Readonly<Record<string, string>> = {
  CREATED: 'Awaiting approval',
  APPROVED: 'Approved',
  PAYMENT_INITIATED: 'Payment sent',
  PAYMENT_CONFIRMED: 'Payment confirmed',
  SETTLED: 'Paid out',
};

function SettlementDetail() {
  const { id } = useParams({ from: '/app/settlements/$id' });
  const statement = useAsync(() => apiClient().settlement(id));

  async function download(): Promise<void> {
    if (!statement.data) return;
    const csv = await apiClient().statementCsv(id);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `zipzap-${statement.data.reference}.csv`;
    anchor.click();
    // Revoked immediately — a Blob URL pins its blob until the document unloads.
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={statement.data?.reference ?? 'Settlement'}
        description="Frozen at approval. This is the set of collections that made up the figure."
        actions={
          statement.data ? (
            <Button variant="secondary" onClick={() => void download()}>
              Download statement (CSV)
            </Button>
          ) : null
        }
      />

      {statement.error ? (
        <ErrorState message={statement.error} retry={statement.reload} />
      ) : !statement.data ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <caption className="sr-only">Collections included in this settlement</caption>
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Parcel
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  What
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  When
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {statement.data.lines.map((line) => (
                <tr key={line.entryId}>
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    {line.shipmentId ? (
                      <Link
                        to="/app/shipments/$id"
                        params={{ id: line.shipmentId }}
                        className="font-mono text-slate-900 underline"
                      >
                        {line.shipmentId.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </th>
                  <td className="px-4 py-3 text-slate-600">
                    {line.memo ?? line.type}
                    {line.memo !== null ? (
                      <span className="ml-2 font-mono text-xs text-slate-400">{line.type}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatWhen(line.occurredAt)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">
                    {formatMinor(line.direction * line.amountMinor, statement.data!.currency)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <th
                  scope="row"
                  className="px-4 py-3 text-left font-medium text-slate-900"
                  colSpan={3}
                >
                  Total — {STATUS_TEXT[statement.data.status] ?? statement.data.status}
                </th>
                <td className="px-4 py-3 text-right font-mono text-lg font-semibold tabular-nums text-slate-900">
                  {formatMinor(statement.data.netMinor, statement.data.currency)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
