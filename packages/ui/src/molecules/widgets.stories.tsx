import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatCard } from './StatCard.tsx';
import { EmptyState } from './EmptyState.tsx';
import { ErrorState } from './ErrorState.tsx';
import { Timeline } from './Timeline.tsx';
import { Table } from './Table.tsx';
import { Badge } from '../atoms/Badge.tsx';
import { MoneyText } from '../atoms/MoneyText.tsx';

const meta = {
  title: 'Molecules/StatCard',
  component: StatCard,
  args: { label: 'In transit', value: '1,284' },
} satisfies Meta<typeof StatCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { hint: '+8% vs last week' } };

export const EmptyShipments: StoryObj = {
  render: () => (
    <EmptyState
      title="No shipments yet"
      description="Create your first shipment to see it move through the lanes."
      action={{ label: 'Create shipment', onClick: () => {} }}
    />
  ),
};

export const LoadFailed: StoryObj = {
  render: () => <ErrorState message="Could not load the dashboard." retry={() => {}} />,
};

export const TrackingTimeline: StoryObj = {
  render: () => (
    <Timeline
      events={[
        { at: '2026-10-07 09:12', label: 'Out for delivery', detail: 'Rider R-114, Banani zone' },
        { at: '2026-10-07 06:40', label: 'Arrived at destination hub', detail: 'DHK-SOUTH' },
        { at: '2026-10-06 22:03', label: 'Line-haul departed', detail: 'DHK-MAIN → DHK-SOUTH' },
      ]}
    />
  ),
};

interface Row {
  readonly code: string;
  readonly status: string;
  readonly cod: number;
}

export const ShipmentsTable: StoryObj = {
  render: () => (
    <Table<Row>
      rowKey={(r) => r.code}
      columns={[
        { header: 'Code', cell: (r) => r.code },
        {
          header: 'Status',
          cell: (r) => (
            <Badge tone={r.status === 'DELIVERED' ? 'success' : 'info'}>{r.status}</Badge>
          ),
        },
        { header: 'COD', cell: (r) => <MoneyText amountMinor={r.cod} currency="BDT" /> },
      ]}
      rows={[
        { code: 'ZZ-1042', status: 'IN_TRANSIT', cod: 125050 },
        { code: 'ZZ-1043', status: 'DELIVERED', cod: 89900 },
      ]}
    />
  ),
};
