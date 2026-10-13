import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { BulkActionBar } from './BulkActionBar.tsx';

/**
 * `BulkActionBar` replaces the `FilterBar` rather than layering over it, and the whole design
 * rests on one conditional: at zero selected rows it must render *nothing*, so the toolbar's row
 * height does not jump every time a checkbox is ticked. Getting that wrong produces a visible
 * layout shift on every single click of a header checkbox.
 */

describe('BulkActionBar', () => {
  test('renders nothing when nothing is selected', () => {
    const { container } = render(<BulkActionBar count={0} onClear={() => {}} />);
    // Not "renders an empty bar". The component returns null so the toolbar does not shift.
    expect(container).toBeEmptyDOMElement();
  });

  test('renders a labelled region once rows are selected', () => {
    render(<BulkActionBar count={3} onClear={() => {}} />);
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toBeInTheDocument();
  });

  test('pluralises with the count and the default noun', () => {
    render(<BulkActionBar count={3} onClear={() => {}} />);
    expect(screen.getByText('3 rows selected')).toBeInTheDocument();
  });

  test('uses the supplied noun so the bar reads as the record type', () => {
    // "3 shipments selected", not "3 rows selected" — the bar sits above a list of parcels and
    // a merchant should not have to infer what is selected.
    render(<BulkActionBar count={12} noun="shipments" onClear={() => {}} />);
    expect(screen.getByText('12 shipments selected')).toBeInTheDocument();
  });

  test('the singular still reads correctly', () => {
    render(<BulkActionBar count={1} noun="shipment" onClear={() => {}} />);
    expect(screen.getByText('1 shipment selected')).toBeInTheDocument();
  });

  test('Clear fires onClear', async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    render(<BulkActionBar count={3} onClear={onClear} />);

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  test('renders caller actions alongside Clear', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <BulkActionBar count={3} onClear={() => {}}>
        <button type="button" onClick={onConfirm}>
          Assign rider
        </button>
      </BulkActionBar>,
    );

    await user.click(screen.getByRole('button', { name: 'Assign rider' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  test('renders with no children at all', () => {
    render(<BulkActionBar count={2} onClear={() => {}} />);
    const region = screen.getByRole('region', { name: 'Bulk actions' });
    expect(within(region).getAllByRole('button')).toHaveLength(1);
  });

  test('appears and disappears as the selection changes', () => {
    // The layout-stability contract, asserted as an actual mount/unmount rather than a
    // visibility check — the difference between `hidden` and `null` is exactly the bug.
    const { rerender } = render(<BulkActionBar count={0} onClear={() => {}} />);
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();

    rerender(<BulkActionBar count={1} onClear={() => {}} />);
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toBeInTheDocument();

    rerender(<BulkActionBar count={0} onClear={() => {}} />);
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  test('Clear is a plain button that does not submit an enclosing form', async () => {
    // Hardcoded `type="button"`, unlike `Button`. The bar commonly sits inside a filter form and
    // clearing a selection must never save that form.
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <BulkActionBar count={3} onClear={() => {}} />
      </form>,
    );

    expect(screen.getByRole('button', { name: 'Clear' })).toHaveAttribute('type', 'button');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('is reachable by its region name, not just by role', () => {
    // `role="region"` is only useful with an accessible name; an unnamed region is not exposed
    // as a landmark at all, so the aria-label is load-bearing rather than decorative.
    render(<BulkActionBar count={5} onClear={() => {}} />);
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toBeInTheDocument();
    expect(screen.queryAllByRole('region')).toHaveLength(1);
  });

  test('merges a caller className onto the bar', () => {
    render(<BulkActionBar count={1} onClear={() => {}} className="mt-2" />);
    const region = screen.getByRole('region', { name: 'Bulk actions' });
    expect(region).toHaveClass('mt-2');
    expect(region.className).toContain('rounded-lg');
  });
});
