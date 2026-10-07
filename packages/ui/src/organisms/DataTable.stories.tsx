import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DataTable, type DataTableColumn } from './DataTable.tsx';
import { BulkActionBar } from './BulkActionBar.tsx';
import { FilterBar } from './FilterBar.tsx';
import { KpiRow } from './KpiRow.tsx';
import { Badge } from '../atoms/Badge.tsx';
import { MoneyText } from '../atoms/MoneyText.tsx';
import { Select } from '../atoms/Select.tsx';
import { Button } from '../atoms/Button.tsx';

interface Shipment {
  readonly code: string;
  readonly hub: string;
  readonly status: string;
  readonly cod: number;
  readonly rider: string;
  readonly attempts: number;
}

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  DELIVERED: 'success',
  IN_TRANSIT: 'info',
  PICKUP_PENDING: 'warning',
  RETURNED: 'danger',
};

const HUB_OPTIONS = ['DHK-MAIN', 'DHK-SOUTH', 'CTG-CENTRAL', 'SYL-NORTH'].map((h) => ({
  value: h,
  label: h,
}));

const ROWS: ReadonlyArray<Shipment> = [
  {
    code: 'ZZ-1042',
    hub: 'DHK-MAIN',
    status: 'IN_TRANSIT',
    cod: 125050,
    rider: 'R-114',
    attempts: 1,
  },
  {
    code: 'ZZ-1043',
    hub: 'DHK-SOUTH',
    status: 'DELIVERED',
    cod: 89900,
    rider: 'R-207',
    attempts: 0,
  },
  {
    code: 'ZZ-1044',
    hub: 'CTG-CENTRAL',
    status: 'PICKUP_PENDING',
    cod: 45000,
    rider: '—',
    attempts: 0,
  },
  {
    code: 'ZZ-1045',
    hub: 'DHK-MAIN',
    status: 'RETURNED',
    cod: 210075,
    rider: 'R-088',
    attempts: 3,
  },
  {
    code: 'ZZ-1046',
    hub: 'SYL-NORTH',
    status: 'DELIVERED',
    cod: 64000,
    rider: 'R-331',
    attempts: 1,
  },
  {
    code: 'ZZ-1047',
    hub: 'DHK-SOUTH',
    status: 'IN_TRANSIT',
    cod: 187500,
    rider: 'R-114',
    attempts: 2,
  },
  {
    code: 'ZZ-1048',
    hub: 'DHK-MAIN',
    status: 'PICKUP_PENDING',
    cod: 32000,
    rider: '—',
    attempts: 0,
  },
  {
    code: 'ZZ-1049',
    hub: 'CTG-CENTRAL',
    status: 'DELIVERED',
    cod: 154900,
    rider: 'R-402',
    attempts: 1,
  },
  {
    code: 'ZZ-1050',
    hub: 'SYL-NORTH',
    status: 'IN_TRANSIT',
    cod: 73000,
    rider: 'R-207',
    attempts: 0,
  },
  {
    code: 'ZZ-1051',
    hub: 'DHK-MAIN',
    status: 'DELIVERED',
    cod: 268000,
    rider: 'R-088',
    attempts: 1,
  },
  {
    code: 'ZZ-1052',
    hub: 'DHK-SOUTH',
    status: 'RETURNED',
    cod: 95000,
    rider: 'R-331',
    attempts: 4,
  },
];

const COLUMNS: ReadonlyArray<DataTableColumn<Shipment>> = [
  {
    id: 'code',
    header: 'Code',
    cell: (r) => <span className="font-medium">{r.code}</span>,
    accessor: (r) => r.code,
  },
  {
    id: 'status',
    header: 'Status',
    accessor: (r) => r.status,
    cell: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>,
  },
  { id: 'hub', header: 'Hub', accessor: (r) => r.hub },
  { id: 'rider', header: 'Rider', accessor: (r) => r.rider },
  {
    id: 'cod',
    header: 'COD',
    align: 'right',
    accessor: (r) => r.cod,
    cell: (r) => <MoneyText amountMinor={r.cod} currency="BDT" />,
  },
  {
    id: 'attempts',
    header: 'Attempts',
    align: 'right',
    accessor: (r) => r.attempts,
    defaultHidden: true,
  },
];

const meta = {
  title: 'Organisms/DataTable',
  component: DataTable,
} satisfies Meta<typeof DataTable>;

export default meta;
// Render-only stories use the bare `StoryObj`, matching widgets.stories.tsx —
// `StoryObj<typeof meta>` would demand `args` for a generic component.
type RowStory = StoryObj;

export const Default: RowStory = {
  render: () => (
    <DataTable<Shipment> caption="Shipments" rowKey={(r) => r.code} columns={COLUMNS} rows={ROWS} />
  ),
};

export const Compact: RowStory = {
  render: () => (
    <DataTable<Shipment>
      caption="Shipments"
      rowKey={(r) => r.code}
      columns={COLUMNS}
      rows={ROWS}
      density="compact"
      pageSizes={[5, 10, 25]}
    />
  ),
};

export const Selectable: RowStory = {
  render: () => {
    const [selected, setSelected] = useState<ReadonlyArray<string>>([]);
    return (
      <div className="flex flex-col gap-3">
        <BulkActionBar count={selected.length} noun="shipments" onClear={() => setSelected([])}>
          <Button size="sm">Assign rider</Button>
          <Button size="sm" variant="secondary">
            Print label
          </Button>
          <Button size="sm" variant="destructive">
            Cancel
          </Button>
        </BulkActionBar>
        <DataTable<Shipment>
          caption="Shipments"
          rowKey={(r) => r.code}
          columns={COLUMNS}
          rows={ROWS}
          selectable
          onSelectionChange={setSelected}
        />
      </div>
    );
  },
};

export const WithFilters: RowStory = {
  render: () => {
    const [search, setSearch] = useState('');
    const [hub, setHub] = useState('');
    const filtered = ROWS.filter(
      (r) =>
        (hub === '' || r.hub === hub) &&
        (search === '' ||
          `${r.code} ${r.rider} ${r.status}`.toLowerCase().includes(search.toLowerCase())),
    );
    return (
      <div className="flex flex-col gap-4">
        <KpiRow
          items={[
            { label: 'In transit', value: '1,284', hint: '+8% vs last week' },
            { label: 'Delivered', value: '942' },
            { label: 'COD collected', value: <MoneyText amountMinor={184250075} currency="BDT" /> },
            { label: 'Returned', value: '37', hint: '3.1% of total' },
          ]}
        />
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search code, rider…"
          onReset={() => {
            setSearch('');
            setHub('');
          }}
          showReset={hub !== ''}
        >
          <Select
            aria-label="Hub"
            name="hub"
            className="h-10 w-auto"
            value={hub}
            onChange={(e) => setHub(e.target.value)}
            options={[{ value: '', label: 'All hubs' }, ...HUB_OPTIONS]}
          />
        </FilterBar>
        <DataTable<Shipment>
          caption="Shipments"
          rowKey={(r) => r.code}
          columns={COLUMNS}
          rows={filtered}
          searchable={false}
        />
      </div>
    );
  },
};

export const Loading: RowStory = {
  render: () => (
    <DataTable<Shipment>
      caption="Shipments"
      rowKey={(r) => r.code}
      columns={COLUMNS}
      rows={[]}
      loading
    />
  ),
};

export const Errored: RowStory = {
  render: () => (
    <DataTable<Shipment>
      caption="Shipments"
      rowKey={(r) => r.code}
      columns={COLUMNS}
      rows={ROWS}
      error="Could not load shipments. Check your connection."
    />
  ),
};

export const Empty: RowStory = {
  render: () => (
    <DataTable<Shipment>
      caption="Shipments"
      rowKey={(r) => r.code}
      columns={COLUMNS}
      rows={[]}
      empty={
        <div className="rounded-lg border border-dashed border-slate-300 px-6 py-12 text-center">
          <p className="font-medium text-slate-800">No shipments yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Create your first shipment to see it move through the lanes.
          </p>
        </div>
      }
    />
  ),
};
