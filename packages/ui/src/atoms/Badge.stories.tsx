import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from './Badge.tsx';

const meta = {
  title: 'Atoms/Badge',
  component: Badge,
  argTypes: {
    tone: { control: 'select', options: ['neutral', 'success', 'warning', 'danger', 'info'] },
  },
  args: { children: 'OUT_FOR_DELIVERY' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};
export const Success: Story = { args: { tone: 'success', children: 'DELIVERED' } };
export const Warning: Story = { args: { tone: 'warning', children: 'RETRY_SCHEDULED' } };
export const Danger: Story = { args: { tone: 'danger', children: 'LOST' } };
export const Info: Story = { args: { tone: 'info', children: 'IN_TRANSIT' } };
