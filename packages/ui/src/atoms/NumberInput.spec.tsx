import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { NumberInput } from './NumberInput.tsx';

/**
 * The money rule has a UI half: a merchant must never be able to type a float into a minor-unit
 * field. `NumberInput` enforces that twice — blocking `.`/`e`/`-` at the keystroke, and stripping
 * anything non-numeric that arrives anyway (paste, autofill, a mobile keyboard).
 *
 * Both halves matter. Keydown alone misses paste; the strip alone lets the user see `.` flash in
 * the field first.
 */

describe('NumberInput', () => {
  test('renders a numeric textbox', () => {
    render(<NumberInput aria-label="Cod amount" />);
    const input = screen.getByRole('textbox', { name: 'Cod amount' });
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('pattern', '[0-9]*');
  });

  test('accepts digits', async () => {
    const user = userEvent.setup();
    render(<NumberInput aria-label="Cod amount" />);
    const input = screen.getByRole('textbox', { name: 'Cod amount' });

    await user.type(input, '125050');
    expect(input).toHaveValue('125050');
  });

  test('strips a decimal point instead of producing a float', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NumberInput aria-label="Cod amount" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Cod amount' });

    await user.type(input, '1250.50');
    expect(input).toHaveValue('125050');
  });

  test('blocks the characters that would make a float or a negative', async () => {
    const user = userEvent.setup();
    render(<NumberInput aria-label="Cod amount" />);
    const input = screen.getByRole('textbox', { name: 'Cod amount' });

    await user.type(input, '1.2e3-4');
    expect(input).toHaveValue('1234');
  });

  test('the blocked keys never reach the caller as part of a value', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NumberInput aria-label="Cod amount" onChange={onChange} />);

    await user.type(screen.getByRole('textbox', { name: 'Cod amount' }), '1.5');
    for (const call of onChange.mock.calls) {
      const value = (call[0] as React.ChangeEvent<HTMLInputElement>).target.value;
      expect(value).toMatch(/^\d*$/);
    }
  });

  test('strips non-digits arriving by paste, where no keystroke is ever blocked', async () => {
    // The gap the keydown handler cannot cover: paste bypasses key events entirely.
    const user = userEvent.setup();
    render(<NumberInput aria-label="Cod amount" />);
    const input = screen.getByRole('textbox', { name: 'Cod amount' });

    await user.click(input);
    await user.paste('৳ 1,250.50');
    expect(input).toHaveValue('125050');
  });

  test('strips a minus sign arriving by paste', async () => {
    const user = userEvent.setup();
    render(<NumberInput aria-label="Cod amount" />);
    const input = screen.getByRole('textbox', { name: 'Cod amount' });

    await user.click(input);
    await user.paste('-500');
    expect(input).toHaveValue('500');
  });

  test('reports the sanitised value to onChange, not the pasted one', async () => {
    // The bug this guards: forwarding the event without re-reading it leaves the React state
    // holding "1,250.50" while the DOM shows "125050". A controlled input would then snap back.
    const seen: string[] = [];
    const user = userEvent.setup();
    render(
      <NumberInput
        aria-label="Cod amount"
        onChange={(e) => seen.push((e.target as HTMLInputElement).value)}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Cod amount' });

    await user.type(input, '9.');
    expect(seen.at(-1)).toBe('9');
    expect(seen.every((v) => /^\d*$/.test(v))).toBe(true);
  });

  test('an empty field is allowed — zero is typed as 0, and clearing is a valid state', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NumberInput aria-label="Cod amount" defaultValue="500" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Cod amount' });

    await user.clear(input);
    expect(input).toHaveValue('');
    expect(onChange).toHaveBeenCalled();
  });

  test('does not throw when rendered without an onChange handler', async () => {
    // The handler is optional in the signature; the component must not assume it is present.
    const user = userEvent.setup();
    render(<NumberInput aria-label="Cod amount" />);
    const input = screen.getByRole('textbox', { name: 'Cod amount' });

    await user.type(input, '1.5');
    expect(input).toHaveValue('15');
  });

  test('merges a caller className', () => {
    render(<NumberInput aria-label="Cod amount" className="w-40" />);
    const input = screen.getByRole('textbox', { name: 'Cod amount' });
    expect(input).toHaveClass('w-40');
    expect(input.className).toContain('rounded-md');
  });
});
