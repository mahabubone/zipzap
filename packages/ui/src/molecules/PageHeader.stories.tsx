import type { Meta, StoryObj } from '@storybook/react-vite';
import { PageHeader } from './PageHeader.tsx';
import { Button } from '../atoms/Button.tsx';

const meta = {
  title: 'Molecules/PageHeader',
  component: PageHeader,
  args: { title: 'Shipments' },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {};
export const WithDescriptionAndActions: Story = {
  args: {
    description: 'Everything in flight across your tenant.',
    actions: <Button size="sm">Create shipment</Button>,
  },
};
