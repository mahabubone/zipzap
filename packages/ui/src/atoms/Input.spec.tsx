import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { Input } from './Input.tsx';

/**
 * A controlled input and an uncontrolled one are different animals, and a design-system atom
 * has to work as both. The component forwards every prop to the DOM node, so the interesting
 * assertions are about what survives that spread — `invalid` becoming `aria-invalid`, and the
 * caller's `value`/`onChange` pair still driving the element.
 */

describe('Input', () => {
  test('renders a textbox with an accessible name from its label', () => {
    render(<Input aria-label="Pickup address" />);
    expect(screen.getByRole('textbox', { name: 'Pickup address' })).toBeInTheDocument();
  });

  test('is a text input by default and lets the caller change the type', () => {
    const { rerender } = render(<Input aria-label="Phone" />);
    const input = screen.getByRole('textbox', { name: 'Phone' });
    // `Input` writes no `type` attribute and inherits the HTML default, so the assertion is on
    // the resolved property rather than on markup that is deliberately absent.
    expect(input).not.toHaveAttribute('type');
    expect(input).toHaveProperty('type', 'text');

    rerender(<Input aria-label="Phone" type="tel" />);
    const tel = screen.getByRole('textbox', { name: 'Phone' });
    expect(tel).toHaveAttribute('type', 'tel');
    expect(tel).toHaveProperty('type', 'tel');
  });

  test('fires onChange with the event so the caller reads target.value', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Input aria-label="City" onChange={onChange} />);

    await user.type(screen.getByRole('textbox', { name: 'City' }), 'D');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0]?.[0] as React.ChangeEvent<HTMLInputElement>).target.value).toBe(
      'D',
    );
  });

  test('works as a controlled input', async () => {
    function Controlled() {
      const [value, setValue] = useState('');
      return <Input aria-label="Zone" value={value} onChange={(e) => setValue(e.target.value)} />;
    }
    const user = userEvent.setup();
    render(<Controlled />);

    await user.type(screen.getByRole('textbox', { name: 'Zone' }), 'Dhaka');
    expect(screen.getByRole('textbox', { name: 'Zone' })).toHaveValue('Dhaka');
  });

  test('works uncontrolled, letting the DOM hold the value', async () => {
    const user = userEvent.setup();
    render(<Input aria-label="Notes" defaultValue="Leave at hub" />);

    const input = screen.getByRole('textbox', { name: 'Notes' });
    expect(input).toHaveValue('Leave at hub');
    await user.type(input, '!');
    expect(input).toHaveValue('Leave at hub!');
  });

  test('a controlled input with no onChange never changes — React owns the value', async () => {
    // The classic controlled-without-a-handler bug: a read-only-looking field that silently
    // swallows keystrokes. Asserted so the demo storybooks and any misuse fail loudly.
    const user = userEvent.setup();
    render(<Input aria-label="Read only" value="Fixed" onChange={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'Read only' });
    await user.type(input, 'xyz');
    expect(input).toHaveValue('Fixed');
  });

  test('invalid sets aria-invalid, and a valid input does not carry the attribute', () => {
    const { rerender } = render(<Input aria-label="Weight" invalid />);
    expect(screen.getByRole('textbox', { name: 'Weight' })).toHaveAttribute('aria-invalid', 'true');
    rerender(<Input aria-label="Weight" invalid={false} />);
    expect(screen.getByRole('textbox', { name: 'Weight' })).not.toHaveAttribute('aria-invalid');
  });

  test('a disabled input is not editable', async () => {
    const user = userEvent.setup();
    render(<Input aria-label="Locked" defaultValue="x" disabled />);
    const input = screen.getByRole('textbox', { name: 'Locked' });
    await user.type(input, 'more');
    expect(input).toHaveValue('x');
  });

  test('forwards placeholder, required and autocomplete through to the DOM', () => {
    render(
      <Input aria-label="Email" placeholder="you@example.com" required autoComplete="email" />,
    );
    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input).toHaveAttribute('placeholder', 'you@example.com');
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('autocomplete', 'email');
  });

  test('merges a caller className', () => {
    render(<Input aria-label="Zip" className="w-32" />);
    const input = screen.getByRole('textbox', { name: 'Zip' });
    expect(input).toHaveClass('w-32');
    expect(input.className).toContain('rounded-md');
  });
});
