import type { Meta, StoryObj } from '@storybook/react-vite';
import { FormField } from './FormField.tsx';
import { Input } from '../atoms/Input.tsx';

const meta = {
  title: 'Molecules/FormField',
  component: FormField,
  args: { label: 'Phone', htmlFor: 'phone', children: null },
  render: (args) => (
    <FormField {...args}>
      <Input id={args.htmlFor} />
    </FormField>
  ),
} satisfies Meta<typeof FormField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { hint: 'BD format, 11 digits' } };
export const WithError: Story = { args: { error: 'This field is required' } };
