import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { RadioCards, RadioGroup } from './RadioGroup.tsx';

/**
 * `RadioGroup` is the accessible wrapper around a set of radios: a shared `name` is what makes
 * them mutually exclusive, and the wrapping `<label>` is what makes the text clickable. Both are
 * easy to lose in a refactor — drop `name` and every option becomes independently selectable,
 * and a merchant picks two delivery speeds and discovers it at the hub.
 */

const OPTIONS = [
  { value: 'standard', label: 'Standard', description: '2–3 days' },
  { value: 'express', label: 'Express', description: 'Next day' },
  { value: 'sameday', label: 'Same day', description: 'Within Dhaka', disabled: true },
];

describe('RadioGroup', () => {
  test('exposes a radiogroup with a radio per option', () => {
    render(<RadioGroup name="speed" value="standard" options={OPTIONS} onChange={() => {}} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  test('the option label and description are both readable', () => {
    render(<RadioGroup name="speed" value="standard" options={OPTIONS} onChange={() => {}} />);
    expect(screen.getByText('Express')).toBeInTheDocument();
    expect(screen.getByText('Next day')).toBeInTheDocument();
  });

  test('names each radio from its wrapping label', () => {
    render(<RadioGroup name="speed" value="standard" options={OPTIONS} onChange={() => {}} />);
    // Clicking the text must toggle the radio; that only works via the wrapping `<label>`.
    expect(screen.getByRole('radio', { name: /Standard/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Express/ })).toBeInTheDocument();
  });

  test('marks exactly the option matching `value` as checked', () => {
    render(<RadioGroup name="speed" value="express" options={OPTIONS} onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: /Express/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Standard/ })).not.toBeChecked();
  });

  test('gives every radio the same name, which is what makes them exclusive', () => {
    render(<RadioGroup name="speed" value="standard" options={OPTIONS} onChange={() => {}} />);
    const names = screen.getAllByRole('radio').map((r) => r.getAttribute('name'));
    // Dropping this — one stray `name` prop — turns an exclusive group into three toggles.
    expect(new Set(names)).toEqual(new Set(['speed']));
  });

  test('reports the option value on change', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RadioGroup name="speed" value="standard" options={OPTIONS} onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: /Express/ }));
    expect(onChange).toHaveBeenCalledWith('express');
  });

  test('clicking the label text selects the radio', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RadioGroup name="speed" value="standard" options={OPTIONS} onChange={onChange} />);

    // The wrapping `<label>` is what makes the text clickable. Without it a merchant has to hit
    // a 16px radio rather than the text they are reading.
    await user.click(screen.getByText('Express'));
    expect(onChange).toHaveBeenCalledWith('express');
  });

  test('clicking the description text also selects, since it is inside the label', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RadioGroup name="speed" value="standard" options={OPTIONS} onChange={onChange} />);

    await user.click(screen.getByText('Next day'));
    expect(onChange).toHaveBeenCalledWith('express');
  });

  test('clicking the label text of a disabled option does not select', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RadioGroup name="speed" value="standard" options={OPTIONS} onChange={onChange} />);

    await user.click(screen.getByText('Same day'));
    expect(onChange).not.toHaveBeenCalled();
  });

  test('selection round-trips through state and stays exclusive', async () => {
    function Host() {
      const [value, setValue] = useState('standard');
      return <RadioGroup name="speed" value={value} options={OPTIONS} onChange={setValue} />;
    }
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getByRole('radio', { name: /Express/ }));
    expect(screen.getByRole('radio', { name: /Express/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Standard/ })).not.toBeChecked();
  });

  test('a disabled option cannot be selected', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RadioGroup name="speed" value="standard" options={OPTIONS} onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: /Same day/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test('an option with no description renders its label alone', () => {
    render(
      <RadioGroup
        name="speed"
        value="a"
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  test('renders a radiogroup for an empty option list without crashing', () => {
    render(<RadioGroup name="speed" value="a" options={[]} onChange={() => {}} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  test('both orientations still expose the same radios', () => {
    // `orientation` is presentational only. Asserting the roles rather than classes keeps this
    // from becoming a Tailwind string test.
    const { rerender } = render(
      <RadioGroup
        name="speed"
        value="standard"
        options={OPTIONS}
        onChange={() => {}}
        orientation="vertical"
      />,
    );
    expect(screen.getAllByRole('radio')).toHaveLength(3);

    rerender(
      <RadioGroup
        name="speed"
        value="standard"
        options={OPTIONS}
        onChange={() => {}}
        orientation="horizontal"
      />,
    );
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });
});

describe('RadioCards', () => {
  test('exposes a radiogroup with a card per option', () => {
    render(<RadioCards name="speed" value="standard" options={OPTIONS} onChange={() => {}} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  test('marks the selected card', () => {
    render(<RadioCards name="speed" value="express" options={OPTIONS} onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: /Express/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Standard/ })).not.toBeChecked();
  });

  test('reports the option value on change', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RadioCards name="speed" value="standard" options={OPTIONS} onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: /Express/ }));
    expect(onChange).toHaveBeenCalledWith('express');
  });

  test('renders an icon alongside the label', () => {
    render(
      <RadioCards
        name="speed"
        value="standard"
        options={[
          { value: 'standard', label: 'Standard', icon: <span data-testid="icon">S</span> },
        ]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByText('Standard')).toBeInTheDocument();
  });

  test('a card without an icon still renders', () => {
    render(
      <RadioCards
        name="speed"
        value="standard"
        options={[{ value: 'standard', label: 'Standard' }]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Standard/ })).toBeInTheDocument();
  });

  test('RadioCards ignores `disabled` on an option, as documented by its narrower prop type', async () => {
    // `RadioCards` does not forward `disabled` — its options type omits it. A caller that
    // supplies one gets it silently dropped. Asserted so the gap is visible rather than implied.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <RadioCards
        name="speed"
        value="standard"
        options={[{ value: 'express', label: 'Express', disabled: true }]}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('radio', { name: /Express/ }));
    expect(onChange).toHaveBeenCalledWith('express');
  });
});
