import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentType } from 'react';
import { Select } from './Select.tsx';
import { Textarea } from './Textarea.tsx';
import { Checkbox } from './Checkbox.tsx';
import { Skeleton } from './Skeleton.tsx';

const meta = {
  title: 'Atoms/Controls',
  component: Select,
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SelectDefault: Story = {
  args: {
    options: [
      { value: 'cod', label: 'Cash on delivery' },
      { value: 'prepaid', label: 'Prepaid' },
    ],
  },
};

export const SelectInvalid: Story = {
  args: { invalid: true, options: [{ value: '', label: 'Pick one' }] },
};

type AnyStory = StoryObj<Meta<ComponentType>>;

export const TextareaNote: AnyStory = {
  render: () => <Textarea placeholder="Collection note for the rider…" />,
};

export const CheckboxChecked: AnyStory = {
  render: () => (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox defaultChecked /> Collect on delivery
    </label>
  ),
};

export const SkeletonBlock: AnyStory = {
  render: () => <Skeleton className="h-24 w-64" />,
};
