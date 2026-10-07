import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell, type NavGroup } from './AppShell.tsx';
import { Avatar } from '../atoms/Avatar.tsx';
import { Badge } from '../atoms/Badge.tsx';
import { Button } from '../atoms/Button.tsx';
import { KpiRow } from './KpiRow.tsx';
import { DataTable, type DataTableColumn } from './DataTable.tsx';
import { PageHeader } from '../molecules/PageHeader.tsx';
import { MoneyText } from '../atoms/MoneyText.tsx';

/** Icons are a slot, not a dependency — the app owns its icon set. These inline
 *  SVGs stand in for whatever the console actually uses. */
const Icon = ({ d }: { readonly d: string }) => (
  <svg
    aria-hidden
    viewBox="0 0 20 20"
    className="size-4 shrink-0 text-slate-400"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
  >
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const icon = (d: string) => <Icon d={d} />;

interface Shipment {
  readonly code: string;
  readonly hub: string;
  readonly status: string;
  readonly cod: number;
}

const ROWS: ReadonlyArray<Shipment> = [
  { code: 'ZZ-1042', hub: 'DHK-MAIN', status: 'IN_TRANSIT', cod: 125050 },
  { code: 'ZZ-1043', hub: 'DHK-SOUTH', status: 'DELIVERED', cod: 89900 },
  { code: 'ZZ-1044', hub: 'CTG-CENTRAL', status: 'PICKUP_PENDING', cod: 45000 },
  { code: 'ZZ-1045', hub: 'DHK-MAIN', status: 'RETURNED', cod: 210075 },
  { code: 'ZZ-1046', hub: 'SYL-NORTH', status: 'DELIVERED', cod: 64000 },
];

const COLUMNS: ReadonlyArray<DataTableColumn<Shipment>> = [
  { id: 'code', header: 'Code', accessor: (r) => r.code },
  { id: 'hub', header: 'Hub', accessor: (r) => r.hub },
  {
    id: 'status',
    header: 'Status',
    accessor: (r) => r.status,
    cell: (r) => <Badge tone={r.status === 'DELIVERED' ? 'success' : 'info'}>{r.status}</Badge>,
  },
  {
    id: 'cod',
    header: 'COD',
    align: 'right',
    accessor: (r) => r.cod,
    cell: (r) => <MoneyText amountMinor={r.cod} currency="BDT" />,
  },
];

/** Mirrors the domain split in docs/domains/_index.md, phased the way the
 *  backend modules are: the day-to-day work first, money and platform after. */
const slug = (l: string) => `#/${l.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/** Mirrors the domain split in docs/domains/_index.md, phased the way the
 *  backend modules are: day-to-day work first, money and platform after.
 *  hrefs are distinct because nav keys on href. */
const NAV: ReadonlyArray<NavGroup> = [
  {
    label: 'Operate',
    items: [
      {
        label: 'Dashboard',
        href: slug('Dashboard'),
        active: true,
        icon: icon('M3 10.5 10 4l7 6.5V16a1 1 0 0 1-1 1h-4v-4H8v4H4a1 1 0 0 1-1-1z'),
      },
      { label: 'Shipments', href: slug('Shipments'), icon: icon('M3 6h10v8H3zM13 9h3l1 2v3h-4z') },
      {
        label: 'Pickups',
        href: slug('Pickups'),
        icon: icon('M4 8h8v6H4zM12 10h3v4h-3z'),
        badge: <Badge tone="warning">12</Badge>,
      },
      { label: 'Deliveries', href: slug('Deliveries'), icon: icon('M3 10h8M8 6l4 4-4 4') },
      {
        label: 'Returns',
        href: slug('Returns'),
        icon: icon('M7 7a3 3 0 1 1-2 5'),
        badge: <Badge tone="danger">4</Badge>,
      },
    ],
  },
  {
    label: 'Network',
    items: [
      {
        label: 'Riders',
        href: slug('Riders'),
        icon: icon('M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 16a6 6 0 0 1 12 0'),
      },
      { label: 'Hubs', href: slug('Hubs'), icon: icon('M3 15V7l7-3 7 3v8l-7 3z') },
    ],
  },
  {
    label: 'Money',
    items: [
      {
        label: 'COD',
        href: slug('COD'),
        icon: icon('M3 6h14v8H3zM10 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3'),
      },
      {
        label: 'Settlements',
        href: slug('Settlements'),
        icon: icon('M4 16V9M8 16V5M12 16v-4M16 16V7'),
      },
      {
        label: 'Pricing rules',
        href: slug('Pricing rules'),
        icon: icon('M5 4h10v12H5zM8 8h4M8 11h4'),
      },
    ],
  },
  {
    label: 'Platform',
    items: [
      {
        label: 'Merchants',
        href: slug('Merchants'),
        icon: icon('M4 8h12l-1 8H5zM7 8V6a3 3 0 0 1 6 0v2'),
      },
      { label: 'Analytics', href: slug('Analytics'), icon: icon('M4 16V9M8 16V5M12 16v-6') },
      {
        label: 'Support',
        href: slug('Support'),
        icon: icon('M10 16a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 11h4'),
      },
    ],
  },
];

const Page = ({ children }: { readonly children: ReactNode }) => children;

const meta = {
  title: 'Organisms/AppShell',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
  args: {
    brand: 'ZipZap Ops',
    nav: NAV,
    topbar: (
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm text-slate-500">DHK-MAIN · Dhaka main hub</span>
        <Badge tone="success">Live</Badge>
      </div>
    ),
    sidebarFooter: (
      <div className="flex items-center gap-2">
        <Avatar name="Rifat Hossain" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800">Rifat Hossain</p>
          <p className="truncate text-xs text-slate-500">Ops manager</p>
        </div>
      </div>
    ),
    children: (
      <Page>
        <div className="space-y-6">
          <PageHeader
            title="Operations"
            description="Today across every lane leaving Dhaka."
            actions={<Button size="sm">Create shipment</Button>}
          />
          <KpiRow
            items={[
              { label: 'In transit', value: '1,284', hint: '+8% vs yesterday' },
              { label: 'Delivered', value: '942' },
              {
                label: 'COD collected',
                value: <MoneyText amountMinor={184250075} currency="BDT" />,
              },
              { label: 'Exceptions', value: '17', hint: '4 returns' },
            ]}
          />
          <DataTable<Shipment>
            caption="Recent shipments"
            rowKey={(r) => r.code}
            columns={COLUMNS}
            rows={ROWS}
          />
        </div>
      </Page>
    ),
  },
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Console: Story = {};

export const NoFooter: Story = {
  args: { sidebarFooter: undefined },
};

export const LongNavOverflows: Story = {
  args: {
    nav: [
      ...NAV,
      {
        label: 'Experimental',
        items: Array.from({ length: 12 }, (_, i) => ({
          label: `Feature flag ${i + 1}`,
          href: `#ff-${i}`,
          icon: icon('M10 6v8M6 10h8'),
        })),
      },
    ],
  },
};
