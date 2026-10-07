import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Dialog } from './Dialog.tsx';
import { Button } from '../atoms/Button.tsx';

const meta = {
  title: 'Molecules/Dialog',
  component: Dialog,
  args: { open: true, title: 'Hold shipment?', onClose: () => {}, children: null },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Held: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open dialog
        </Button>
        <Dialog
          open={open}
          title="Hold shipment ZZ-1042?"
          onClose={() => setOpen(false)}
          actions={<Button onClick={() => setOpen(false)}>Hold it</Button>}
        >
          The rider will be unassigned and the shipment waits at the origin hub.
        </Dialog>
      </>
    );
  },
};
