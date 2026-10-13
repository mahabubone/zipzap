import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ErrorState } from './ErrorState.tsx';

/**
 * `ErrorState` is the retry affordance. Its contract is narrow and load-bearing: the message is
 * always shown, the retry button appears only when a handler exists (a Retry button that does
 * nothing is worse than none), and the default title is a fallback, not a hardcode.
 *
 * `DataTable` renders this with `retry={onRetry}`, which is `undefined` when no handler was
 * passed — so the "no button" branch is reachable in production, not just in tests.
 */

describe('ErrorState', () => {
  test('renders the message', () => {
    render(<ErrorState message="Shipments could not be loaded." />);
    expect(screen.getByText('Shipments could not be loaded.')).toBeInTheDocument();
  });

  test('falls back to a default title when none is given', () => {
    render(<ErrorState message="Shipments could not be loaded." />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  test('uses a supplied title instead of the default', () => {
    render(<ErrorState title="Manifest unavailable" message="Try again shortly." />);
    expect(screen.getByText('Manifest unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  test('shows a Retry button only when a retry handler is supplied', () => {
    const { rerender } = render(<ErrorState message="Boom" />);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

    rerender(<ErrorState message="Boom" retry={() => {}} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  test('retry fires when clicked', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(<ErrorState message="Boom" retry={retry} />);

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test('retry can be called repeatedly — a slow failure must be retryable, not one-shot', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(<ErrorState message="Boom" retry={retry} />);

    const button = screen.getByRole('button', { name: 'Retry' });
    await user.click(button);
    await user.click(button);
    await user.click(button);
    expect(retry).toHaveBeenCalledTimes(3);
  });

  test('the message is shown verbatim, not truncated or prefixed', () => {
    // The backend's §87 envelope puts a human-readable message here. Rewriting it loses the
    // one piece of information the merchant can act on.
    const message = 'COD settlement is locked until 14:00 — a payout is already in flight.';
    render(<ErrorState message={message} />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  test('the retry button does not submit an enclosing form', async () => {
    // This test used to pin the opposite, on the grounds that the fix belonged in `Button`. It was
    // fixed in `Button`: every form in this product states `type="submit"` on the button that
    // submits it, so the HTML default was buying nothing and costing an accidental form post —
    // a Retry inside a create-shipment form wiped the draft the user had just typed.
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <ErrorState message="Boom" retry={() => {}} />
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('title, message and retry can all appear together', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(<ErrorState title="Upload failed" message="File exceeds 10 MB." retry={retry} />);

    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByText('File exceeds 10 MB.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
