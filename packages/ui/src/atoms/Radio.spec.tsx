import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { Radio } from './Radio.tsx';

/**
 * A radio is meaningless without a shared `name` — that is what makes a group mutually
 * exclusive — so most of what matters here is that name, value and checked all survive the
 * prop spread, and that the browser really does enforce the single-selection rule rather than
 * the component pretending to.
 */

describe('Radio', () => {
  test('renders a radio with an accessible name', () => {
    render(<Radio aria-label="Standard delivery" name="speed" value="standard" />);
    expect(screen.getByRole('radio', { name: 'Standard delivery' })).toBeInTheDocument();
  });

  test('is always type="radio"', () => {
    render(<Radio aria-label="Standard" name="speed" value="standard" />);
    expect(screen.getByRole('radio', { name: 'Standard' })).toHaveAttribute('type', 'radio');
  });

  test('reflects the checked prop', () => {
    const { rerender } = render(<Radio aria-label="Standard" name="speed" checked={false} />);
    expect(screen.getByRole('radio', { name: 'Standard' })).not.toBeChecked();
    rerender(<Radio aria-label="Standard" name="speed" checked />);
    expect(screen.getByRole('radio', { name: 'Standard' })).toBeChecked();
  });

  test('fires onChange when selected', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Radio aria-label="Express" name="speed" value="express" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Express' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0]?.[0] as React.ChangeEvent<HTMLInputElement>).target.value).toBe(
      'express',
    );
  });

  test('radios sharing a name are mutually exclusive', async () => {
    // Enforced by the DOM, not by this component. Asserting it anyway: it is the behaviour
    // `RadioGroup` relies on, and a caller who forgets `name` gets a group that selects all.
    const user = userEvent.setup();
    render(
      <>
        <Radio aria-label="Standard" name="speed" value="standard" defaultChecked />
        <Radio aria-label="Express" name="speed" value="express" />
        <Radio aria-label="Same day" name="speed" value="same-day" />
      </>,
    );

    const express = screen.getByRole('radio', { name: 'Express' });
    await user.click(express);
    expect(express).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Standard' })).not.toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Same day' }));
    expect(screen.getByRole('radio', { name: 'Same day' })).toBeChecked();
    expect(express).not.toBeChecked();
  });

  test('clicking an already-checked radio leaves it checked and does not re-fire onChange', async () => {
    // Documented because callers drive `checked` from state: a re-click must be a no-op, or a
    // handler that pushes the value back up produces a pointless re-render on every tap.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Radio aria-label="Standard" name="speed" defaultChecked onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Standard' }));
    expect(screen.getByRole('radio', { name: 'Standard' })).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('is operable from the keyboard arrow keys within a group', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Radio aria-label="Standard" name="speed" value="standard" defaultChecked />
        <Radio aria-label="Express" name="speed" value="express" />
      </>,
    );

    await user.tab();
    expect(screen.getByRole('radio', { name: 'Standard' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Express' })).toBeChecked();
  });

  test('a disabled radio does not fire onChange', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Radio aria-label="Same day" name="speed" onChange={onChange} disabled />);

    await user.click(screen.getByRole('radio', { name: 'Same day' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test('forwards name, value and required through to the DOM', () => {
    render(<Radio aria-label="Standard" name="speed" value="standard" required />);
    const radio = screen.getByRole('radio', { name: 'Standard' });
    expect(radio).toHaveAttribute('name', 'speed');
    expect(radio).toHaveAttribute('value', 'standard');
    expect(radio).toBeRequired();
  });

  test('merges a caller className', () => {
    render(<Radio aria-label="Standard" name="speed" className="mt-0.5" />);
    const radio = screen.getByRole('radio', { name: 'Standard' });
    expect(radio).toHaveClass('mt-0.5');
    expect(radio.className).toContain('size-4');
  });
});
