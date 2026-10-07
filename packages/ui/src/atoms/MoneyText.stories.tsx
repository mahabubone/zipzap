import type { Meta, StoryObj } from '@storybook/react-vite';
import { MoneyText } from './MoneyText.tsx';

const meta = {
  title: 'Atoms/MoneyText',
  component: MoneyText,
  args: { amountMinor: 125050, currency: 'BDT' },
} satisfies Meta<typeof MoneyText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Taka: Story = {};
export const Dollars: Story = { args: { amountMinor: 9900, currency: 'USD' } };
export const Large: Story = { args: { amountMinor: 123456789, currency: 'BDT' } };
