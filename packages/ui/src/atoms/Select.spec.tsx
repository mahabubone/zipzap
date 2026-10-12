import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { Select } from './Select.tsx';

/**
 * `Select` is unusual for this kit: it takes `options` as data rather than children, so the
 * caller cannot hand it a mismatched `<option>`/`<Select>` pair. The risk is the opposite —
 * options silently dropping, or the value string and the number the caller expects drifting
 * apart (`'25'` vs `25`) at the boundary.
 */

const STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_transit', label: 'In transit' },
  { value: 'delivered', label: 'Delivered' },
];

describe('Select', () => {
  test('renders every option with its label', () => {
    render(<Select aria-label="Status" options={STATUSES} />);
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('option', { name: 'In transit' })).toBeInTheDocument();
  });

  test('option value and visible label are independent', () => {
    // The label is prose, the value is a wire identifier. A coder-style value must not leak
    // into what the merchant reads.
    render(
      <Select aria-label="Hub" options={[{ value: 'khulna_dhaka', label: 'Khulna → Dhaka' }]} />,
    );
    const option = screen.getByRole('option', { name: 'Khulna → Dhaka' });
    expect(option).toHaveValue('khulna_dhaka');
  });

  test('shows the browser default when no value is given', () => {
    render(<Select aria-label="Status" options={STATUSES} />);
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('pending');
  });

  test('honours an explicit value', () => {
    render(<Select aria-label="Status" options={STATUSES} value="delivered" />);
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('delivered');
  });

  test('fires onChange with the selected option value', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Select aria-label="Status" options={STATUSES} onChange={onChange} />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'in_transit');
    expect(onChange).toHaveBeenCalledTimes(1);
    const event = onChange.mock.calls[0]?.[0] as React.ChangeEvent<HTMLSelectElement>;
    expect(event.target.value).toBe('in_transit');
  });

  test('a controlled select round-trips through state', async () => {
    const seen: string[] = [];
    function Controlled() {
      const [value, setValue] = useState('pending');
      return (
        <Select
          aria-label="Status"
          options={STATUSES}
          value={value}
          onChange={(e) => {
            seen.push(e.target.value);
            setValue(e.target.value);
          }}
        />
      );
    }
    const user = userEvent.setup();
    render(<Controlled />);

    const select = screen.getByRole('combobox', { name: 'Status' });
    await user.selectOptions(select, 'delivered');
    expect(select).toHaveValue('delivered');
    expect(seen).toEqual(['delivered']);
  });

  test('numeric page sizes arrive as strings and are converted by the caller', async () => {
    // `Pagination` does `Number(e.target.value)` at the call site. This pins the contract that
    // justifies it: the DOM only ever hands back a string.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Select
        aria-label="Rows per page"
        options={[
          { value: '10', label: '10' },
          { value: '25', label: '25' },
        ]}
        onChange={onChange}
      />,
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '25');
    const raw = (onChange.mock.calls[0]?.[0] as React.ChangeEvent<HTMLSelectElement>).target.value;
    expect(raw).toBe('25');
    expect(Number(raw)).toBe(25);
  });

  test('a value with no matching option falls back to the first option', () => {
    // What the DOM actually does, and what the merchant sees: a stale value from a cached query
    // leaves the control showing option one, not blank. Worth pinning so a caller can rely on
    // "never empty" and can detect the stale case by comparing values.
    render(<Select aria-label="Status" options={STATUSES} value="cancelled" />);
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('pending');
  });

  test('a select with no options resolves to an empty value', () => {
    render(<Select aria-label="Hub" options={[]} value="anything" />);
    const select = screen.getByRole('combobox', { name: 'Hub' });
    // Nothing to match against, so the resolved value is the empty string — asserted on the
    // property, since `toHaveValue` on a `<select>` reads the selected option rather than this.
    expect(select).toHaveProperty('value', '');
  });

  test('invalid sets aria-invalid, and a valid select does not carry the attribute', () => {
    const { rerender } = render(<Select aria-label="Status" options={STATUSES} invalid />);
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    rerender(<Select aria-label="Status" options={STATUSES} invalid={false} />);
    expect(screen.getByRole('combobox', { name: 'Status' })).not.toHaveAttribute('aria-invalid');
  });

  test('an empty option list renders a combobox with nothing to choose', () => {
    render(<Select aria-label="Hub" options={[]} />);
    expect(screen.getByRole('combobox', { name: 'Hub' })).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  test('a disabled select cannot be changed', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Select
        aria-label="Status"
        options={STATUSES}
        defaultValue="pending"
        onChange={onChange}
        disabled
      />,
    );
    await user
      .selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'delivered')
      .catch(() => undefined);
    expect(onChange).not.toHaveBeenCalled();
  });
});
