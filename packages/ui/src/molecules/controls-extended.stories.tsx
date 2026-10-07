import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentType } from 'react';
import { Pagination } from './Pagination.tsx';
import { Tabs, TabPanel } from './Tabs.tsx';
import { Tooltip } from './Tooltip.tsx';
import { Breadcrumbs } from './Breadcrumbs.tsx';
import { Dropdown, DropdownItem, DropdownLabel } from './Dropdown.tsx';
import { RadioGroup, RadioCards } from './RadioGroup.tsx';
import { Button } from '../atoms/Button.tsx';
import { Switch } from '../atoms/Switch.tsx';
import { Progress } from '../atoms/Progress.tsx';
import { Label } from '../atoms/Label.tsx';
import { Badge } from '../atoms/Badge.tsx';

const meta = {
  title: 'Molecules/Navigation',
  component: Pagination,
} satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;
type AnyStory = StoryObj<Meta<ComponentType>>;

export const PaginationDefault: Story = {
  args: {
    pageIndex: 2,
    pageCount: 18,
    pageSize: 25,
    pageSizes: [10, 25, 50, 100],
    totalRows: 437,
    onPageIndexChange: () => {},
    onPageSizeChange: () => {},
  },
};

export const PaginationSinglePage: Story = {
  args: {
    pageIndex: 0,
    pageCount: 1,
    pageSize: 25,
    pageSizes: [10, 25, 50],
    totalRows: 6,
    onPageIndexChange: () => {},
    onPageSizeChange: () => {},
  },
};

export const PaginationEmpty: Story = {
  args: {
    pageIndex: 0,
    pageCount: 0,
    pageSize: 10,
    pageSizes: [10, 25],
    totalRows: 0,
    onPageIndexChange: () => {},
  },
};

export const TabsDefault: AnyStory = {
  render: () => {
    const [tab, setTab] = useState('events');
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: 'events', label: 'Events', badge: '24' },
            { id: 'details', label: 'Details' },
            { id: 'payments', label: 'Payments', badge: '2' },
          ]}
        />
        <TabPanel value={tab} when="events">
          <p className="text-sm text-slate-500">Tracking events appear here.</p>
        </TabPanel>
        <TabPanel value={tab} when="details">
          <p className="text-sm text-slate-500">Package dimensions and weight.</p>
        </TabPanel>
        <TabPanel value={tab} when="payments">
          <p className="text-sm text-slate-500">COD collection record.</p>
        </TabPanel>
      </div>
    );
  },
};

export const DropdownDefault: AnyStory = {
  render: () => (
    <Dropdown
      trigger={
        <Button variant="secondary" size="sm">
          Actions ▾
        </Button>
      }
    >
      {(close) => (
        <>
          <DropdownLabel>Shipment</DropdownLabel>
          <DropdownItem
            onSelect={() => {
              close();
            }}
          >
            Reassign rider
          </DropdownItem>
          <DropdownItem
            onSelect={() => {
              close();
            }}
          >
            Print label
          </DropdownItem>
          <DropdownItem
            danger
            onSelect={() => {
              close();
            }}
          >
            Cancel shipment
          </DropdownItem>
        </>
      )}
    </Dropdown>
  ),
};

export const BreadcrumbsDefault: AnyStory = {
  render: () => (
    <Breadcrumbs
      items={[
        { label: 'Shipments', href: '#' },
        { label: 'DHK-SOUTH', href: '#' },
        { label: 'ZZ-1042' },
      ]}
    />
  ),
};

export const RadioGroupDefault: AnyStory = {
  render: () => {
    const [mode, setMode] = useState('cod');
    return (
      <RadioGroup
        name="payment-mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'cod', label: 'Cash on delivery', description: 'Rider collects at handover.' },
          { value: 'prepaid', label: 'Prepaid', description: 'Paid online at checkout.' },
        ]}
      />
    );
  },
};

export const RadioCardsDefault: AnyStory = {
  render: () => {
    const [hub, setHub] = useState('dhk-main');
    return (
      <RadioCards
        name="origin-hub"
        value={hub}
        onChange={setHub}
        options={[
          { value: 'dhk-main', label: 'DHK-MAIN', description: 'Dhaka main hub · 1,240/day' },
          { value: 'dhk-south', label: 'DHK-SOUTH', description: 'Dhaka south hub · 610/day' },
        ]}
      />
    );
  },
};

export const SwitchDefault: AnyStory = {
  render: () => {
    const [on, setOn] = useState(true);
    return (
      <div className="flex items-center gap-3">
        <Switch checked={on} onChange={setOn} label="Auto-assign rider" />
        <span className="text-sm text-slate-700">Auto-assign rider</span>
      </div>
    );
  },
};

export const ProgressDefault: AnyStory = {
  render: () => (
    <div className="flex w-64 flex-col gap-3">
      <Progress value={68} label="Settlement funded" />
      <Progress value={100} tone="success" label="Delivered" />
      <Progress value={24} tone="warning" label="Attempted" />
      <Progress value={4} tone="danger" label="Returned" />
    </div>
  ),
};

export const TooltipDefault: AnyStory = {
  render: () => (
    <div className="flex items-center gap-6">
      <Tooltip label="Riders within 3 km of the hub">
        <Button variant="secondary" size="sm">
          Hover me
        </Button>
      </Tooltip>
      <span className="text-sm text-slate-500">
        Focus the button with Tab for the same tooltip.
      </span>
    </div>
  ),
};

export const LabelDefault: AnyStory = {
  render: () => (
    <Label required htmlFor="demo">
      Merchant name
    </Label>
  ),
};

export const BadgeTones: AnyStory = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge>NEUTRAL</Badge>
      <Badge tone="info">IN_TRANSIT</Badge>
      <Badge tone="success">DELIVERED</Badge>
      <Badge tone="warning">PICKUP_PENDING</Badge>
      <Badge tone="danger">RETURNED</Badge>
    </div>
  ),
};
