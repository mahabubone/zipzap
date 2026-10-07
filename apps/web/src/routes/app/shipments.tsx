import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Badge, DataTable, MoneyText, PageHeader, type DataTableColumn } from '@zipzap/ui';
import type { ShipmentSummary } from '@zipzap/api-client';
import { apiClient } from '../../lib/api.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { formatWhen, humanStatus, statusTone } from '../../lib/format.ts';

export const Route = createFileRoute('/app/shipments')({
  component: Shipments,
});

const PAGE = 100;

function Shipments() {
  const navigate = useNavigate();
  const page = useAsync(() => apiClient().listShipments({ limit: String(PAGE) }));

  const columns: ReadonlyArray<DataTableColumn<ShipmentSummary>> = [
    {
      id: 'trackingCode',
      header: 'Tracking',
      accessor: (s) => s.trackingCode,
      cell: (s) => <span className="font-medium text-slate-900">{s.trackingCode}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (s) => s.status,
      cell: (s) => <Badge tone={statusTone(s.status)}>{humanStatus(s.status)}</Badge>,
    },
    {
      id: 'merchantReference',
      header: 'Reference',
      accessor: (s) => s.merchantReference ?? '',
      cell: (s) => s.merchantReference ?? <span className="text-slate-400">—</span>,
      defaultHidden: true,
    },
    {
      id: 'cod',
      header: 'COD',
      align: 'right',
      accessor: (s) => s.codAmountMinor,
      cell: (s) => <MoneyText amountMinor={s.codAmountMinor} currency={s.codCurrency as 'BDT'} />,
    },
    {
      id: 'createdAt',
      header: 'Created',
      accessor: (s) => s.createdAt,
      cell: (s) => <span className="text-slate-500">{formatWhen(s.createdAt)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Shipments"
        description={
          page.data
            ? `${page.data.data.length} most recent of your account${
                page.data.hasMore ? ', more on the server' : ''
              }.`
            : 'Your account’s shipments, newest first.'
        }
      />

      <DataTable
        caption="Your shipments, newest first"
        columns={columns}
        rows={page.data?.data ?? []}
        rowKey={(s) => s.id}
        loading={page.loading}
        error={page.error ?? undefined}
        onRowClick={(s) => void navigate({ to: '/app/shipments/$id', params: { id: s.id } })}
        empty={
          <p className="py-6 text-center text-sm text-slate-500">
            No shipments yet. Create one from the API to see it here.
          </p>
        }
      />
    </div>
  );
}
