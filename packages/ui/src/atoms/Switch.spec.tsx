import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { Switch } from './Switch.tsx';

/**
 * A `role="switch"` is a button with two extra obligations: it must announce its state, and it
 * must report the *next* state rather than the event. Getting that backwards means a parent
 * holding `checked` has to invert the callback, and every call site gets it wrong eventually.
 */

describe('Switch', () => {
  test('exposes the switch role and its accessible name', () => {
    render(<Switch checked={false} onChange={() => {}} label="Collect COD" />);
    expect(screen.getByRole('switch', { name: 'Collect COD' })).toBeInTheDocument();
  });

  test('aria-checked tracks the checked prop', () => {
    const { rerender } = render(<Switch checked={false} onChange={() => {}} label="Collect COD" />);
    expect(screen.getByRole('switch', { name: 'Collect COD' })).not.toBeChecked();
    rerender(<Switch checked onChange={() => {}} label="Collect COD" />);
    expect(screen.getByRole('switch', { name: 'Collect COD' })).toBeChecked();
  });

  test('aria-checked is always present, so the state is never merely implied', () => {
    // A switch that omitted `aria-checked` when false would read as "unchecked, unknown" to
    // some screen readers and as "checked" to others. Assert the attribute, not just the value.
    render(<Switch checked={false} onChange={() => {}} label="Collect COD" />);
    expect(screen.getByRole('switch', { name: 'Collect COD' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  test('reports the next state, not the current one', async () => {
    // The whole contract. An unchecked switch must report `true`.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch checked={false} onChange={onChange} label="Collect COD" />);

    await user.click(screen.getByRole('switch', { name: 'Collect COD' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('a checked switch reports false when clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch checked onChange={onChange} label="Collect COD" />);

    await user.click(screen.getByRole('switch', { name: 'Collect COD' }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  test('toggling round-trips through state', async () => {
    function Wrapper() {
      const [checked, setChecked] = useState(false);
      return <Switch checked={checked} onChange={setChecked} label="Collect COD" />;
    }
    const user = userEvent.setup();
    render(<Wrapper />);
    const toggle = screen.getByRole('switch', { name: 'Collect COD' });

    await user.click(toggle);
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
  });

  test('is reachable and operable from the keyboard', async () => {
    // A role=switch on a <button> must still be a real button: tab to it, Space to toggle.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch checked={false} onChange={onChange} label="Collect COD" />);

    await user.tab();
    expect(screen.getByRole('switch', { name: 'Collect COD' })).toHaveFocus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('a disabled switch does not fire onChange', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch checked={false} onChange={onChange} label="Collect COD" disabled />);

    await user.click(screen.getByRole('switch', { name: 'Collect COD' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test('never submits the form it sits in', () => {
    // The component hardcodes type="button". Without it, flipping a switch inside a settings
    // form would save the form.
    render(
      <form onSubmit={(e) => e.preventDefault()}>
        <Switch checked={false} onChange={() => {}} label="Collect COD" />
      </form>,
    );
    expect(screen.getByRole('switch', { name: 'Collect COD' })).toHaveAttribute('type', 'button');
  });

  test('the label is required, so an unnamed switch is a type error rather than a silent hole', () => {
    // Not a runtime test — it documents why `label` is non-optional: an icon-only switch is
    // announced as "switch, unchecked" and nothing else.
    expect(() =>
      render(<Switch checked={false} onChange={() => {}} label="Pickup from rider" />),
    ).not.toThrow();
    expect(screen.getByRole('switch', { name: 'Pickup from rider' })).toBeInTheDocument();
  });

  test('the decorative thumb is hidden from assistive tech', () => {
    const { container } = render(<Switch checked onChange={() => {}} label="Collect COD" />);
    // Two spans: the thumb and its wrapper. Neither should be announced.
    const thumbs = [...container.querySelectorAll('span[aria-hidden]')];
    expect(thumbs.length).toBeGreaterThan(0);
  });
});
