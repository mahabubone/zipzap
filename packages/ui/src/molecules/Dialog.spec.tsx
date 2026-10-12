import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { Dialog } from './Dialog.tsx';

/**
 * `Dialog` is uncontrolled-by-convention: the caller owns `open` and must close it. Two things
 * can go wrong and both are silent — the Escape/overlay handlers firing when the dialog is
 * closed (a keypress on the page behind would call `onClose` forever), and clicking the overlay
 * not closing at all because the inner panel failed to stop propagation.
 *
 * The `onClose` dependency in the keydown effect is deliberate: it re-binds on every render, so a
 * stale closure cannot leave Escape closing a dialog whose handler has since changed.
 */

function openDialog(overrides: Partial<Parameters<typeof Dialog>[0]> = {}) {
  const onClose = vi.fn();
  const user = userEvent.setup();
  const view = render(
    <Dialog open title="Cancel shipment" onClose={onClose} {...overrides}>
      This cannot be undone.
    </Dialog>,
  );
  return { ...view, onClose, user };
}

describe('Dialog', () => {
  test('renders nothing when closed', () => {
    render(
      <Dialog open={false} title="Cancel shipment" onClose={() => {}}>
        Body
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel shipment')).not.toBeInTheDocument();
  });

  test('renders a modal dialog named by its title when open', () => {
    const { onClose } = openDialog();
    const dialog = screen.getByRole('dialog', { name: 'Cancel shipment' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(onClose).not.toHaveBeenCalled();
  });

  test('renders the title as a heading and the children as body', () => {
    openDialog();
    expect(screen.getByRole('heading', { name: 'Cancel shipment' })).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  test('Escape closes the dialog', async () => {
    const { onClose, user } = openDialog();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('does not register an Escape handler while closed', async () => {
    // The subtle one. If the effect ran unconditionally, a keypress anywhere on the page would
    // call `onClose` on a dialog that was never open — and the caller's `setOpen(false)` would
    // be masking a whole class of unrelated bug.
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog open={false} title="Cancel shipment" onClose={onClose}>
        Body
      </Dialog>,
    );

    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  test('the Close button closes the dialog', async () => {
    const { onClose, user } = openDialog();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('clicking the overlay closes the dialog', async () => {
    const { onClose, user } = openDialog();
    // The overlay is the fixed full-screen parent; clicking it is a click-outside.
    const overlay = screen.getByRole('dialog').parentElement as HTMLElement;
    await user.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('clicking inside the panel does not close the dialog', async () => {
    // Without `stopPropagation` on the inner panel, every click on the body text or the action
    // buttons would bubble to the overlay and close the dialog before the action ran.
    const { onClose, user } = openDialog();
    await user.click(screen.getByText('This cannot be undone.'));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('an action button inside the panel does not close it by bubbling either', async () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog
        open
        title="Cancel shipment"
        onClose={onClose}
        actions={
          <button type="button" onClick={onAction}>
            Confirm
          </button>
        }
      >
        Body
      </Dialog>,
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  test('renders caller actions alongside the Close button', async () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog
        open
        title="Cancel shipment"
        onClose={onClose}
        actions={
          <button type="button" onClick={onAction}>
            Confirm cancel
          </button>
        }
      >
        Body
      </Dialog>,
    );

    expect(screen.getByRole('button', { name: 'Confirm cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm cancel' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  test('renders no action area content when actions are omitted', () => {
    const { onClose } = openDialog();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  test('opening and closing re-binds Escape to the current onClose', async () => {
    // The handler is in the effect's dependency list, so a caller that swaps `onClose` between
    // renders gets the new one. Without the dep, Escape would close via a stale reference.
    const first = vi.fn();
    const second = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <Dialog open title="Cancel shipment" onClose={first}>
        Body
      </Dialog>,
    );

    rerender(
      <Dialog open title="Cancel shipment" onClose={second}>
        Body
      </Dialog>,
    );

    await user.keyboard('{Escape}');
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  test('a dialog reopened after closing still responds to Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <Dialog open={false} title="Cancel shipment" onClose={onClose}>
        Body
      </Dialog>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <Dialog open title="Cancel shipment" onClose={onClose}>
        Body
      </Dialog>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
