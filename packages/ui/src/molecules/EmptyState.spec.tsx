import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { EmptyState } from './EmptyState.tsx';

/**
 * An empty list is the screen a merchant sees most often early on, and the action in it is the
 * only thing between them and their first shipment. So: the title is always there, the optional
 * parts really are optional, and the action button is a real `<Button>` — which means it needs
 * an explicit type inside a form.
 */

describe('EmptyState', () => {
  test('renders the title', () => {
    render(<EmptyState title="No shipments yet" />);
    expect(screen.getByText('No shipments yet')).toBeInTheDocument();
  });

  test('renders the description when given', () => {
    render(
      <EmptyState title="No shipments yet" description="Create one to get a tracking code." />,
    );
    expect(screen.getByText('Create one to get a tracking code.')).toBeInTheDocument();
  });

  test('omits the description when absent', () => {
    render(<EmptyState title="No shipments yet" />);
    expect(screen.getByText('No shipments yet')).toBeInTheDocument();
    expect(screen.queryByText('Create one to get a tracking code.')).not.toBeInTheDocument();
  });

  test('treats an empty description as absent', () => {
    const { container } = render(<EmptyState title="No shipments yet" description="" />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  test('renders the action button labelled by its label, and it fires', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<EmptyState title="No shipments yet" action={{ label: 'Create shipment', onClick }} />);

    const button = screen.getByRole('button', { name: 'Create shipment' });
    expect(button).toBeInTheDocument();
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('renders no button when there is no action', () => {
    render(<EmptyState title="No shipments yet" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('the action inherits Button submit semantics inside a form', async () => {
    // `EmptyState` renders a default `Button`, and `Button` deliberately writes no `type`
    // attribute, inheriting the HTML default of `submit`. So an action inside a `<form>` does
    // submit it. Pinned as-is rather than "fixed" here: `Button`'s default is a documented
    // decision (a bare `<Button>Save</Button>` in a form must submit), and changing it belongs
    // in `Button`, not in a molecule. Callers who need a non-submitting action inside a form
    // pass their own `action` button rather than this one.
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <EmptyState
          title="No shipments yet"
          action={{ label: 'Create shipment', onClick: () => {} }}
        />
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'Create shipment' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test('renders a supplied icon node', () => {
    render(<EmptyState title="No parcels" icon={<span data-testid="icon">📦</span>} />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  test('omits the icon wrapper when no icon is supplied', () => {
    render(<EmptyState title="No parcels" />);
    expect(screen.queryByTestId('icon')).not.toBeInTheDocument();
  });

  test('title, description and action can all appear together', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        title="No COD to collect"
        description="Riders collect cash on delivery."
        action={{ label: 'View manifest', onClick }}
      />,
    );

    expect(screen.getByText('No COD to collect')).toBeInTheDocument();
    expect(screen.getByText('Riders collect cash on delivery.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View manifest' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
