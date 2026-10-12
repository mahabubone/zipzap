import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { Pagination } from './Pagination.tsx';

/**
 * `Pagination` contains the only real algorithm in the molecules folder: `pageWindow`, which
 * collapses a long page list to `1 … 4 5 6 … 20`. Off-by-one there produces a pager that skips a
 * page or renders a gap where a page should be, and nobody notices until someone is on page 40.
 *
 * The tests below read the nav as a sequence of tokens — digits and ellipses — rather than
 * asserting class names, so they describe what the merchant can actually reach.
 */

describe('Pagination', () => {
  test('reports the visible range and the total', () => {
    render(
      <Pagination
        pageIndex={0}
        pageCount={5}
        pageSize={10}
        totalRows={50}
        onPageIndexChange={() => {}}
      />,
    );
    expect(screen.getByText('1–10 of 50')).toBeInTheDocument();
  });

  test('the range is correct on a middle page', () => {
    render(
      <Pagination
        pageIndex={2}
        pageCount={5}
        pageSize={10}
        totalRows={50}
        onPageIndexChange={() => {}}
      />,
    );
    expect(screen.getByText('21–30 of 50')).toBeInTheDocument();
  });

  test('the last page clamps the end of the range to the total', () => {
    render(
      <Pagination
        pageIndex={4}
        pageCount={5}
        pageSize={10}
        totalRows={43}
        onPageIndexChange={() => {}}
      />,
    );
    expect(screen.getByText('41–43 of 43')).toBeInTheDocument();
  });

  test('zero rows says so instead of showing 1–0', () => {
    render(
      <Pagination
        pageIndex={0}
        pageCount={0}
        pageSize={10}
        totalRows={0}
        onPageIndexChange={() => {}}
      />,
    );
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  test('page buttons are numbered from one, not zero', () => {
    render(
      <Pagination
        pageIndex={0}
        pageCount={3}
        pageSize={10}
        totalRows={30}
        onPageIndexChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '0' })).not.toBeInTheDocument();
  });

  test('the current page is marked aria-current', () => {
    render(
      <Pagination
        pageIndex={1}
        pageCount={5}
        pageSize={10}
        totalRows={50}
        onPageIndexChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '1' })).not.toHaveAttribute('aria-current');
  });

  test('clicking a page reports its zero-based index', async () => {
    const onPageIndexChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Pagination
        pageIndex={0}
        pageCount={5}
        pageSize={10}
        totalRows={50}
        onPageIndexChange={onPageIndexChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: '3' }));
    expect(onPageIndexChange).toHaveBeenCalledWith(2);
  });

  test('previous is disabled on the first page and reports index -1 nowhere', async () => {
    const onPageIndexChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Pagination
        pageIndex={0}
        pageCount={5}
        pageSize={10}
        totalRows={50}
        onPageIndexChange={onPageIndexChange}
      />,
    );

    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageIndexChange).not.toHaveBeenCalled();
  });

  test('next is disabled on the last page', () => {
    render(
      <Pagination
        pageIndex={4}
        pageCount={5}
        pageSize={10}
        totalRows={50}
        onPageIndexChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  test('next steps forward by one', async () => {
    const onPageIndexChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Pagination
        pageIndex={2}
        pageCount={5}
        pageSize={10}
        totalRows={50}
        onPageIndexChange={onPageIndexChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageIndexChange).toHaveBeenCalledWith(3);
  });

  test('previous steps back by one', async () => {
    const onPageIndexChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Pagination
        pageIndex={2}
        pageCount={5}
        pageSize={10}
        totalRows={50}
        onPageIndexChange={onPageIndexChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageIndexChange).toHaveBeenCalledWith(1);
  });

  test('a single page renders no pager at all', () => {
    render(
      <Pagination
        pageIndex={0}
        pageCount={1}
        pageSize={10}
        totalRows={4}
        onPageIndexChange={() => {}}
      />,
    );
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
    expect(screen.getByText('1–4 of 4')).toBeInTheDocument();
  });

  test('short page lists are shown in full, with no ellipsis', () => {
    render(
      <Pagination
        pageIndex={0}
        pageCount={7}
        pageSize={10}
        totalRows={70}
        onPageIndexChange={() => {}}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(nav).queryByText('…')).not.toBeInTheDocument();
    for (const n of ['1', '2', '3', '4', '5', '6', '7']) {
      expect(within(nav).getByRole('button', { name: n })).toBeInTheDocument();
    }
  });

  test('a long page list collapses to 1 … 4 5 6 … 20 around the current page', () => {
    render(
      <Pagination
        pageIndex={4}
        pageCount={20}
        pageSize={10}
        totalRows={200}
        onPageIndexChange={() => {}}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    // 1 and 20 are always reachable; the middle three track the current page.
    for (const n of ['1', '4', '5', '6', '20']) {
      expect(within(nav).getByRole('button', { name: n })).toBeInTheDocument();
    }
    expect(within(nav).getAllByText('…')).toHaveLength(2);
    expect(within(nav).queryByRole('button', { name: '10' })).not.toBeInTheDocument();
  });

  test('the first and last page are always reachable, even when far from the current page', () => {
    // The reason for the ellipsis: a merchant on page 3 of 200 must be able to jump to the end
    // without clicking 197 times.
    render(
      <Pagination
        pageIndex={2}
        pageCount={200}
        pageSize={10}
        totalRows={2000}
        onPageIndexChange={() => {}}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(nav).getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: '200' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: '3' })).toBeInTheDocument();
  });

  test('no ellipsis appears when the window reaches an end', () => {
    // At page 2 of 20 the window is 1 2 3 … 20 — the leading ellipsis has nothing to elide.
    render(
      <Pagination
        pageIndex={1}
        pageCount={20}
        pageSize={10}
        totalRows={200}
        onPageIndexChange={() => {}}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(nav).getAllByText('…')).toHaveLength(1);
  });

  test('every page from the window is clickable and reports the right index', async () => {
    const onPageIndexChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Pagination
        pageIndex={9}
        pageCount={20}
        pageSize={10}
        totalRows={200}
        onPageIndexChange={onPageIndexChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: '20' }));
    expect(onPageIndexChange).toHaveBeenCalledWith(19);
  });

  test('the page-size select appears only when a handler is supplied', () => {
    const { rerender } = render(
      <Pagination
        pageIndex={0}
        pageCount={5}
        pageSize={10}
        pageSizes={[10, 25]}
        totalRows={50}
        onPageIndexChange={() => {}}
      />,
    );
    expect(screen.queryByRole('combobox', { name: 'Rows per page' })).not.toBeInTheDocument();

    rerender(
      <Pagination
        pageIndex={0}
        pageCount={5}
        pageSize={10}
        pageSizes={[10, 25]}
        totalRows={50}
        onPageIndexChange={() => {}}
        onPageSizeChange={() => {}}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toBeInTheDocument();
  });

  test('changing the page size reports a number, not the raw string', async () => {
    const onPageSizeChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Pagination
        pageIndex={0}
        pageCount={5}
        pageSize={10}
        pageSizes={[10, 25, 50]}
        totalRows={50}
        onPageIndexChange={() => {}}
        onPageSizeChange={onPageSizeChange}
      />,
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '25');
    expect(onPageSizeChange).toHaveBeenCalledWith(25);
  });

  test('the page-size select reflects the current size', () => {
    render(
      <Pagination
        pageIndex={0}
        pageCount={5}
        pageSize={25}
        pageSizes={[10, 25, 50]}
        totalRows={50}
        onPageIndexChange={() => {}}
        onPageSizeChange={() => {}}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toHaveValue('25');
  });

  test('page sizes of different magnitudes still convert to numbers', async () => {
    const onPageSizeChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Pagination
        pageIndex={0}
        pageCount={2}
        pageSize={100}
        pageSizes={[100, 250]}
        totalRows={300}
        onPageIndexChange={() => {}}
        onPageSizeChange={onPageSizeChange}
      />,
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '250');
    expect(onPageSizeChange).toHaveBeenCalledWith(250);
    expect(typeof onPageSizeChange.mock.calls[0]?.[0]).toBe('number');
  });

  test('the range recomputes when the page size changes', () => {
    // pageIndex 1 at size 25 is rows 26–50, not 11–20. A stale `pageSize` here makes the
    // merchant think rows are missing.
    render(
      <Pagination
        pageIndex={1}
        pageCount={3}
        pageSize={25}
        totalRows={75}
        onPageIndexChange={() => {}}
      />,
    );
    expect(screen.getByText('26–50 of 75')).toBeInTheDocument();
  });

  test('a page size larger than the total still reports a sane range', () => {
    render(
      <Pagination
        pageIndex={0}
        pageCount={1}
        pageSize={100}
        totalRows={7}
        onPageIndexChange={() => {}}
      />,
    );
    expect(screen.getByText('1–7 of 7')).toBeInTheDocument();
  });
});
