import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  Badge,
  Button,
  DataTable,
  FilterBar,
  Input,
  MoneyText,
  PageHeader,
  Select,
  type DataTableColumn,
} from '@zipzap/ui';
import type { ShipmentSummary } from '@zipzap/api-client';
import { apiClient } from '../../lib/api.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { formatWhen, humanStatus, statusTone, zoneLabel } from '../../lib/format.ts';
import { STATUS_GROUPS } from '../../lib/statusGroups.ts';
import {
  FIRST_PAGE,
  currentCursor,
  newer,
  older,
  pageNumber,
  type CursorStack,
} from '../../lib/cursorStack.ts';
import {
  NO_FILTERS,
  clampRange,
  isFiltered,
  queryKey,
  shipmentQuery,
  type Filters,
} from '../../lib/filters.ts';

export const Route = createFileRoute('/app/shipments/')({
  component: Shipments,
});

const PAGE = 25;

function Shipments() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);

  // A cursor is one-way, so going back means replaying a stack — see cursorStack.ts,
  // which scripts/verify-cursor-stack.mjs asserts.
  const [cursors, setCursors] = useState<CursorStack>(FIRST_PAGE);
  const cursor = currentCursor(cursors);

  // Any filter change invalidates every cursor: page 4 of the old filter has no
  // meaning in the new one, and keeping it would silently show a page from the
  // middle of a list the merchant never asked for.
  const set = (patch: Partial<Filters>) => {
    setFilters((current) => clampRange({ ...current, ...patch }));
    setCursors(FIRST_PAGE);
  };

  const page = useAsync(
    () => apiClient().listShipments(shipmentQuery(filters, cursor, PAGE)),
    queryKey(filters, cursor),
  );

  // Read from the server: zones are network configuration, and a hardcoded list
  // offers a retired zone and hides a new one.
  const zones = useAsync(() => apiClient().zones(), 'zones');

  const goOlder = () => setCursors((stack) => older(stack, page.data?.nextCursor ?? null));
  const goNewer = () => setCursors(newer);
  const filtered = isFiltered(filters);

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
      id: 'zone',
      header: 'Zone',
      accessor: (s) => s.zone ?? '',
      cell: (s) =>
        s.zone ? (
          <span className="text-slate-600">{zoneLabel(s.zone)}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
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
            ? `Page ${pageNumber(cursors)}, newest first${filtered ? ', filtered' : ''}${
                page.data.hasMore ? ' — more below' : ' — nothing older left'
              }.`
            : 'Your account’s shipments, newest first.'
        }
        actions={
          <Button size="sm" onClick={() => void navigate({ to: '/app/shipments/new' })}>
            New shipment
          </Button>
        }
      />

      <FilterBar
        searchValue={filters.q}
        onSearchChange={(q) => set({ q })}
        searchPlaceholder="Tracking code or phone"
        onReset={() => {
          setFilters(NO_FILTERS);
          setCursors(FIRST_PAGE);
        }}
        showReset={filtered}
      >
        <Select
          aria-label="Status"
          name="status"
          className="h-10 w-auto"
          value={filters.status}
          onChange={(e) => set({ status: e.target.value })}
          options={STATUS_GROUPS.map((g) => ({ value: g.value, label: g.label }))}
        />
        <Select
          aria-label="Zone"
          name="zone"
          className="h-10 w-auto"
          value={filters.zone}
          onChange={(e) => set({ zone: e.target.value })}
          options={[
            { value: '', label: 'All zones' },
            ...(zones.data ?? []).map((z) => ({ value: z, label: zoneLabel(z) })),
          ]}
        />
        <Input
          aria-label="Created from"
          name="from"
          type="date"
          className="h-10 w-auto"
          value={filters.from}
          max={filters.to === '' ? undefined : filters.to}
          onChange={(e) => set({ from: e.target.value })}
        />
        <Input
          aria-label="Created to"
          name="to"
          type="date"
          className="h-10 w-auto"
          value={filters.to}
          min={filters.from === '' ? undefined : filters.from}
          onChange={(e) => set({ to: e.target.value })}
        />
      </FilterBar>

      <DataTable
        caption="Your shipments, newest first"
        columns={columns}
        rows={page.data?.data ?? []}
        rowKey={(s) => s.id}
        loading={page.loading}
        error={page.error ?? undefined}
        onRetry={page.reload}
        onRowClick={(s) => void navigate({ to: '/app/shipments/$id', params: { id: s.id } })}
        serverPage={{
          hasMore: page.data?.hasMore ?? false,
          canGoBack: pageNumber(cursors) > 1,
          onNext: goOlder,
          onBack: goNewer,
        }}
        empty={
          filtered ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-slate-500">
                Nothing matches these filters. Widen the date range, or clear them.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  setFilters(NO_FILTERS);
                  setCursors(FIRST_PAGE);
                }}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-slate-500">
                No shipments yet. Create your first one and it appears here.
              </p>
              <Button size="sm" onClick={() => void navigate({ to: '/app/shipments/new' })}>
                Create a shipment
              </Button>
            </div>
          )
        }
      />
    </div>
  );
}
