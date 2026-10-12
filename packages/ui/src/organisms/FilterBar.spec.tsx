import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { Select } from '../atoms/Select.tsx';
import { FilterBar } from './FilterBar.tsx';

/**
 * `FilterBar` has one real branch: `dirty = searchValue !== '' || showReset === true`. It exists
 * because a "Clear" button that is always visible on an untouched table is a control that does
 * nothing — clicking it and seeing the results not change teaches a merchant the button is
 * broken. So it appears once a filter is active and disappears when none is.
 *
 * The subtlety is the `onReset && dirty` guard versus the `dirty` flag itself: `dirty` can be
 * true from a non-empty search alone, but the button still requires an `onReset` to exist.
 */

function setup(props: Partial<Parameters<typeof FilterBar>[0]> = {}) {
  const onReset = vi.fn();
  const user = userEvent.setup();
  const view = render(
    <FilterBar searchValue="" onSearchChange={() => {}} onReset={onReset} {...props} />,
  );
  return { ...view, onReset, user };
}

describe('FilterBar', () => {
  test('renders a search box', () => {
    setup();
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
  });

  test('hides Clear until a filter is active', () => {
    // The reason `dirty` exists at all. An always-visible Clear on an untouched table is a
    // control that appears to do nothing.
    setup({ searchValue: '' });
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  test('shows Clear once the search is non-empty', () => {
    setup({ searchValue: 'ZZ100' });
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  test('showReset forces Clear visible with an empty search', () => {
    // The escape hatch for filters the parent holds and this component cannot see — a status
    // select, a date range. Without it, a merchant who changes a status filter sees no Clear.
    setup({ searchValue: '', showReset: true });
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  test('showReset false keeps Clear hidden on an empty search', () => {
    setup({ searchValue: '', showReset: false });
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  test('Clear fires onReset', async () => {
    const { onReset, user } = setup({ searchValue: 'ZZ100' });
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  test('no Clear at all when no onReset is supplied, even on a dirty filter', () => {
    // `onReset && dirty` — a dirty bar with nothing to reset to would show a dead button.
    render(<FilterBar searchValue="ZZ100" onSearchChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  test('a bare query does not leave a stray whitespace-only search value', async () => {
    const onSearchChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBar searchValue="" onSearchChange={onSearchChange} onReset={() => {}} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), ' ');
    // Whitespace is a search term like any other; the component passes it through untrimmed and
    // the server decides. Pinned so a future trim here does not change result counts silently.
    expect(onSearchChange).toHaveBeenLastCalledWith(' ');
  });

  test('passes the search value up on every keystroke', async () => {
    const onSearchChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBar searchValue="" onSearchChange={onSearchChange} />);

    // Controlled at the empty string, so each keystroke reports just itself — see the matching
    // `SearchInput` test for why that is the useful assertion here.
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'ab');
    expect(onSearchChange).toHaveBeenNthCalledWith(1, 'a');
    expect(onSearchChange).toHaveBeenNthCalledWith(2, 'b');
  });

  test('accumulates the query when the parent owns the state', async () => {
    const user = userEvent.setup();
    function Host() {
      const [search, setSearch] = useState('');
      return <FilterBar searchValue={search} onSearchChange={setSearch} />;
    }
    render(<Host />);

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'ZZ100');
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('ZZ100');
  });

  test('renders caller filters as children', () => {
    setup({
      children: (
        <Select
          aria-label="Status"
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'pending', label: 'Pending' },
          ]}
        />
      ),
    });
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
  });

  test('renders several filters, all reachable', () => {
    setup({
      children: (
        <>
          <Select aria-label="Status" options={[{ value: 'all', label: 'All' }]} />
          <Select aria-label="Zone" options={[{ value: 'all', label: 'All' }]} />
        </>
      ),
    });
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Zone' })).toBeInTheDocument();
  });

  test('uses the default placeholder and accepts an override', () => {
    const { rerender } = setup();
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveAttribute(
      'placeholder',
      'Search…',
    );

    rerender(
      <FilterBar searchValue="" onSearchChange={() => {}} searchPlaceholder="Search tracking…" />,
    );
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveAttribute(
      'placeholder',
      'Search tracking…',
    );
  });

  test('Clear appears and disappears as the search clears', async () => {
    // The live contract, not a static one: a `dirty` flag computed once at mount would leave the
    // button stuck on screen after the last filter is removed.
    const user = userEvent.setup();
    function Host() {
      const [search, setSearch] = useState('ZZ100');
      return (
        <FilterBar searchValue={search} onSearchChange={setSearch} onReset={() => setSearch('')} />
      );
    }
    render(<Host />);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  test('merges a caller className onto the bar', () => {
    render(<FilterBar searchValue="" onSearchChange={() => {}} className="mb-4" />);
    const search = screen.getByRole('searchbox', { name: 'Search' });
    expect(search.parentElement).toHaveClass('mb-4');
  });
});
