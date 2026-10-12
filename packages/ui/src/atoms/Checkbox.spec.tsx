import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { Checkbox } from './Checkbox.tsx';

/**
 * `Checkbox` exists for one non-obvious reason: the DataTable header checkbox is tri-state, and
 * `indeterminate` is a DOM property that no HTML attribute can set. It therefore has to be
 * reachable through a ref. If the ref forwarding regressed, the header would show "unchecked"
 * while rows below it were selected — the worst kind of wrong, because it looks intentional.
 */

describe('Checkbox', () => {
  test('renders a checkbox with an accessible name', () => {
    render(<Checkbox aria-label="Select all" />);
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toBeInTheDocument();
  });

  test('is always type="checkbox" and cannot be coerced into a radio', () => {
    // The component sets `type` before spreading `...rest`, so a caller passing `type="radio"`
    // would win. Pinned here so a future reorder fails this test instead of a data table.
    render(<Checkbox aria-label="Select all" />);
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toHaveAttribute(
      'type',
      'checkbox',
    );
  });

  test('reflects the checked prop', () => {
    const { rerender } = render(<Checkbox aria-label="Pickup" checked={false} />);
    expect(screen.getByRole('checkbox', { name: 'Pickup' })).not.toBeChecked();
    rerender(<Checkbox aria-label="Pickup" checked />);
    expect(screen.getByRole('checkbox', { name: 'Pickup' })).toBeChecked();
  });

  test('fires onChange when clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Checkbox aria-label="Pickup" onChange={onChange} />);

    await user.click(screen.getByRole('checkbox', { name: 'Pickup' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(
      (onChange.mock.calls[0]?.[0] as React.ChangeEvent<HTMLInputElement>).target.checked,
    ).toBe(true);
  });

  test('toggles as an uncontrolled checkbox', async () => {
    const user = userEvent.setup();
    render(<Checkbox aria-label="Pickup" defaultChecked />);
    const box = screen.getByRole('checkbox', { name: 'Pickup' });

    await user.click(box);
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(box).toBeChecked();
  });

  test('a disabled checkbox does not fire onChange', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Checkbox aria-label="Pickup" onChange={onChange} disabled />);

    await user.click(screen.getByRole('checkbox', { name: 'Pickup' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test('is operable from the keyboard', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Checkbox aria-label="Pickup" onChange={onChange} />);

    await user.tab();
    expect(screen.getByRole('checkbox', { name: 'Pickup' })).toHaveFocus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('forwards inputRef so a tri-state header can set .indeterminate', () => {
    // The reason this prop exists. jsdom keeps `indeterminate` as a property only — it is not
    // reflected to an attribute, which is exactly why the component cannot do it itself.
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox aria-label="Select all rows on this page" inputRef={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current).toBe(
      screen.getByRole('checkbox', { name: 'Select all rows on this page' }),
    );

    ref.current!.indeterminate = true;
    expect(ref.current!.indeterminate).toBe(true);
  });

  test('inputRef can be a callback ref', () => {
    const seen: Array<HTMLInputElement | null> = [];
    render(
      <Checkbox
        aria-label="Select all"
        inputRef={(node) => {
          seen.push(node);
        }}
      />,
    );
    expect(seen[0]).toBeInstanceOf(HTMLInputElement);
  });

  test('forwards name and value for form submission', () => {
    render(<Checkbox aria-label="Pickup" name="parcel_ids" value="p-1" />);
    const box = screen.getByRole('checkbox', { name: 'Pickup' });
    expect(box).toHaveAttribute('name', 'parcel_ids');
    expect(box).toHaveAttribute('value', 'p-1');
  });

  test('merges a caller className', () => {
    render(<Checkbox aria-label="Pickup" className="mt-1" />);
    const box = screen.getByRole('checkbox', { name: 'Pickup' });
    expect(box).toHaveClass('mt-1');
    expect(box.className).toContain('rounded');
  });
});
