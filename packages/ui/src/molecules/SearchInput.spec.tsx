import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { SearchInput } from './SearchInput.tsx';

/**
 * `SearchInput` is the one input whose onChange signature is `string`, not an event. That
 * convenience is the whole point — the call site becomes `onChange={setQuery}` — and it is also
 * the thing that breaks silently: a wrapper that forgets to read `e.target.value` passes
 * `undefined` up and the filter clears itself on every keystroke.
 */

describe('SearchInput', () => {
  test('is a searchbox with an accessible name even with no visible label', () => {
    // `aria-label` is hardcoded. Without it the field is an unlabelled box on a page that may
    // have several of them, and the placeholder alone is not an accessible name.
    render(<SearchInput value="" onChange={() => {}} />);
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
  });

  test('reports the new value as a string, not as an event', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    // `value` is pinned at the empty string, so the input is controlled by a parent that ignores
    // the change. Each keystroke therefore reports just that keystroke — which is exactly what
    // proves the callback gets the DOM value rather than an event object.
    render(<SearchInput value="" onChange={onChange} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'ab');
    expect(onChange).toHaveBeenNthCalledWith(1, 'a');
    expect(onChange).toHaveBeenNthCalledWith(2, 'b');
    expect(typeof onChange.mock.calls[0]?.[0]).toBe('string');
  });

  test('is a controlled input driven by the value prop', async () => {
    function Host() {
      const [query, setQuery] = useState('');
      return <SearchInput value={query} onChange={setQuery} />;
    }
    const user = userEvent.setup();
    render(<Host />);

    const box = screen.getByRole('searchbox', { name: 'Search' });
    await user.type(box, 'ZZ100');
    expect(box).toHaveValue('ZZ100');
  });

  test('a controlled input cannot be cleared by the user, because the parent owns the value', async () => {
    // The classic controlled-without-a-handler signature error: value is set, onChange drops it
    // on the floor, and the field looks frozen rather than broken.
    const user = userEvent.setup();
    render(<SearchInput value="ZZ100" onChange={() => {}} />);
    const box = screen.getByRole('searchbox', { name: 'Search' });

    await user.clear(box);
    expect(box).toHaveValue('ZZ100');
  });

  test('uses the default placeholder when none is given', () => {
    render(<SearchInput value="" onChange={() => {}} />);
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveAttribute(
      'placeholder',
      'Search…',
    );
  });

  test('a supplied placeholder overrides the default', () => {
    render(<SearchInput value="" onChange={() => {}} placeholder="Search tracking…" />);
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveAttribute(
      'placeholder',
      'Search tracking…',
    );
  });

  test('defaults the name to "search" and lets a caller override it', () => {
    const { rerender } = render(<SearchInput value="" onChange={() => {}} />);
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveAttribute('name', 'search');

    rerender(<SearchInput value="" onChange={() => {}} name="manifest" />);
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveAttribute('name', 'manifest');
  });

  test('is of type search, so browsers offer their own clear affordance', () => {
    render(<SearchInput value="" onChange={() => {}} />);
    // `type="search"` rather than `text`: it is what gives the WebKit clear button and the
    // Escape-to-clear behaviour on a filter box.
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveAttribute('type', 'search');
  });

  test('reports an empty string when the box is cleared', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SearchInput value="ZZ100" onChange={onChange} />);

    await user.clear(screen.getByRole('searchbox', { name: 'Search' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  test('merges a caller className with the default width rather than replacing it', () => {
    render(<SearchInput value="" onChange={() => {}} className="w-full" />);
    const box = screen.getByRole('searchbox', { name: 'Search' });
    expect(box).toHaveClass('w-full');
    // `cx` appends, so both survive — see cx.spec.ts for why nothing displaces anything.
    expect(box.className).toContain('w-64');
  });
});
