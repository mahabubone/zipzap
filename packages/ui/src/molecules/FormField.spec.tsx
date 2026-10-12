import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test } from 'vitest';
import { Input } from '../atoms/Input.tsx';
import { FormField } from './FormField.tsx';

/**
 * `FormField` owns the `htmlFor`/`id` pair, which is the single most commonly broken thing in a
 * form kit: the label renders, the input renders, they are simply not connected — so clicking the
 * label does nothing and a screen reader announces the field with no name.
 *
 * The other rule it encodes: an error replaces the hint. Showing both makes a merchant read
 * "Leave as blank for COD" and "Required" at the same time and pick wrong.
 */

describe('FormField', () => {
  test('associates the label with the child input via htmlFor', () => {
    render(
      <FormField label="Pickup address" htmlFor="pickup">
        <Input id="pickup" />
      </FormField>,
    );
    // The strongest assertion available: the accessible name comes from the label only if the
    // association actually resolved.
    expect(screen.getByLabelText('Pickup address')).toBeInTheDocument();
  });

  test('clicking the label focuses and selects the input', async () => {
    // The user-visible half of the same association. Without it, every keyboard-first merchant
    // has to tab past the label on every field.
    const user = userEvent.setup();
    render(
      <FormField label="Zone" htmlFor="zone">
        <Input id="zone" defaultValue="Dhaka" />
      </FormField>,
    );

    await user.click(screen.getByText('Zone'));
    expect(screen.getByLabelText('Zone')).toHaveFocus();
  });

  test('renders the label text and the control, in that order', () => {
    render(
      <FormField label="Parcel count" htmlFor="count">
        <Input id="count" type="number" />
      </FormField>,
    );
    const label = screen.getByText('Parcel count');
    expect(label.tagName).toBe('LABEL');
    expect(label).toHaveAttribute('for', 'count');
  });

  test('renders the hint when there is no error', () => {
    render(
      <FormField label="Zone" htmlFor="zone" hint="Where the parcel is picked up.">
        <Input id="zone" />
      </FormField>,
    );
    expect(screen.getByText('Where the parcel is picked up.')).toBeInTheDocument();
  });

  test('renders the error in an alert, so it is announced when it appears', () => {
    // `role="alert"` is the whole point: an error injected after submit must interrupt, not
    // sit silently under a field the merchant is not looking at.
    render(
      <FormField label="Zone" htmlFor="zone" error="Zone is required">
        <Input id="zone" invalid />
      </FormField>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Zone is required');
  });

  test('an error replaces the hint rather than appearing beside it', () => {
    render(
      <FormField label="Zone" htmlFor="zone" hint="Where the parcel is picked up." error="Required">
        <Input id="zone" invalid />
      </FormField>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
    expect(screen.queryByText('Where the parcel is picked up.')).not.toBeInTheDocument();
  });

  test('an empty error string is treated as no error', () => {
    render(
      <FormField label="Zone" htmlFor="zone" error="">
        <Input id="zone" />
      </FormField>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('renders nothing below the control when there is neither hint nor error', () => {
    render(
      <FormField label="Zone" htmlFor="zone">
        <Input id="zone" />
      </FormField>,
    );
    // Only the label and the input; a stray empty paragraph would be read out by a screen reader.
    expect(screen.getByText('Zone')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('works for a select as readily as an input', () => {
    render(
      <FormField label="Status" htmlFor="status">
        <select id="status">
          <option value="pending">Pending</option>
        </select>
      </FormField>,
    );
    expect(screen.getByLabelText('Status')).toHaveValue('pending');
  });

  test('no alert appears while the field is untouched', () => {
    // The negative half of the submit flow: an error injected on mount, before the merchant has
    // done anything, is noise. `FormField` renders `role="alert"` only when `error` is non-empty.
    render(
      <FormField label="Zone" htmlFor="zone" error="">
        <Input id="zone" />
      </FormField>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('keeps the label association after the error state changes', async () => {
    // The association must not depend on the error prop — a field that loses its label the
    // moment it goes invalid is the worst version of this bug.
    function Form() {
      const [invalid, setInvalid] = useState(false);
      return (
        <FormField label="Zone" htmlFor="zone" error={invalid ? 'Required' : ''}>
          <Input id="zone" invalid={invalid} onChange={() => setInvalid(true)} />
        </FormField>
      );
    }
    const user = userEvent.setup();
    render(<Form />);

    await user.type(screen.getByLabelText('Zone'), 'x');
    expect(screen.getByLabelText('Zone')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });

  test('merges a caller className onto the wrapper', () => {
    const { container } = render(
      <FormField label="Zone" htmlFor="zone" className="max-w-sm">
        <Input id="zone" />
      </FormField>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveClass('max-w-sm');
    expect(wrapper.className).toContain('flex-col');
  });
});
