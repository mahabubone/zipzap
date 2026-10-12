import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { MoneyText } from '../atoms/MoneyText.tsx';
import { DataTable, type DataTableColumn } from './DataTable.tsx';

/**
 * `DataTable` is the one component every list screen depends on, and it is the one with the most
 * ways to be subtly wrong. The cases below are the ones that reach production:
 *
 *  - the global filter must search the `accessor`, not the rendered cell, or a `MoneyText`
 *    column becomes unsearchable;
 *  - `serverPage` must suppress the client pager and search box, because applying either to one
 *    page reads as if it covered the whole list;
 *  - selection must report ids, and only on change — a callback that re-fires on every render
 *    sends a PATCH per keystroke somewhere up the tree.
 */

interface Parcel {
  readonly id: string;
  readonly tracking: string;
  readonly codMinor: number;
  readonly status: string;
}

const PARCELS: ReadonlyArray<Parcel> = [
  { id: 'p-1', tracking: 'ZZ1001', codMinor: 125050, status: 'delivered' },
  { id: 'p-2', tracking: 'ZZ1002', codMinor: 900, status: 'in_transit' },
  { id: 'p-3', tracking: 'ZZ1003', codMinor: 100000, status: 'pending' },
];

const COLUMNS: ReadonlyArray<DataTableColumn<Parcel>> = [
  { id: 'tracking', header: 'Tracking', accessor: (p) => p.tracking },
  {
    id: 'cod',
    header: 'COD',
    accessor: (p) => p.codMinor,
    cell: (p) => <MoneyText amountMinor={p.codMinor} currency="BDT" />,
    align: 'right',
  },
  { id: 'status', header: 'Status', accessor: (p) => p.status },
];

const rowKey = (p: Parcel): string => p.id;

function bodyRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('tbody tr')];
}

function table(): HTMLElement {
  return screen.getByRole('table');
}

/** The COD column's rendered cell text, top to bottom. */
function amountsInOrder(): Array<string | undefined> {
  return bodyRows().map((row) => within(row).getAllByRole('cell')[1]?.textContent);
}

describe('DataTable', () => {
  test('renders the caption, which is the table only accessible name', () => {
    render(<DataTable columns={COLUMNS} rows={PARCELS} rowKey={rowKey} caption="Shipments" />);
    expect(screen.getByRole('table', { name: 'Shipments' })).toBeInTheDocument();
  });

  test('renders one header cell per column', () => {
    render(<DataTable columns={COLUMNS} rows={PARCELS} rowKey={rowKey} caption="Shipments" />);
    const headers = within(table()).getAllByRole('columnheader');
    expect(headers).toHaveLength(3);
    expect(headers[0]).toHaveTextContent('Tracking');
  });

  test('renders one body row per record', () => {
    render(<DataTable columns={COLUMNS} rows={PARCELS} rowKey={rowKey} caption="Shipments" />);
    expect(bodyRows()).toHaveLength(3);
  });

  test('a custom cell renderer wins over the accessor value', () => {
    render(<DataTable columns={COLUMNS} rows={PARCELS} rowKey={rowKey} caption="Shipments" />);
    // The `cod` column renders MoneyText, not the raw `125050`.
    expect(screen.getByText('৳ 1,250.50')).toBeInTheDocument();
    expect(screen.queryByText('125050')).not.toBeInTheDocument();
  });

  test('a column with no cell and no accessor renders empty rather than crashing', () => {
    render(
      <DataTable
        columns={[{ id: 'actions', header: 'Actions' }, ...COLUMNS]}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
      />,
    );
    expect(bodyRows()).toHaveLength(3);
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  test('a display-only column is neither sortable nor searchable', () => {
    // Documented in the props: no accessor means no sort and no filter participation.
    render(
      <DataTable
        columns={[{ id: 'actions', header: 'Actions', cell: () => 'Edit' }, ...COLUMNS]}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
      />,
    );
    expect(screen.queryByRole('button', { name: /Actions/ })).not.toBeInTheDocument();
  });

  test('empty rows render the built-in empty state', () => {
    render(<DataTable columns={COLUMNS} rows={[]} rowKey={rowKey} caption="Shipments" />);
    expect(screen.getByText('No matching rows')).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(0);
  });

  test('a caller-supplied empty state replaces the default', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={[]}
        rowKey={rowKey}
        caption="Shipments"
        empty={<div>Nothing here yet</div>}
      />,
    );
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.queryByText('No matching rows')).not.toBeInTheDocument();
  });

  test('the search box filters rows on the accessor value', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={COLUMNS} rows={PARCELS} rowKey={rowKey} caption="Shipments" />);

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'ZZ1002');
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('ZZ1002')).toBeInTheDocument();
  });

  test('search reaches a custom-rendered column through its accessor', async () => {
    // The reason `accessor` exists separately from `cell`: the COD column renders MoneyText, so
    // a filter over the rendered DOM would match `৳ 1,250.50` and not `125050`. Filtering over
    // the accessor is what makes the column searchable at all.
    const user = userEvent.setup();
    render(<DataTable columns={COLUMNS} rows={PARCELS} rowKey={rowKey} caption="Shipments" />);

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), '125050');
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('৳ 1,250.50')).toBeInTheDocument();
  });

  test('a search with no matches shows the empty state', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={COLUMNS} rows={PARCELS} rowKey={rowKey} caption="Shipments" />);

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'zzzz');
    expect(bodyRows()).toHaveLength(0);
    expect(screen.getByText('No matching rows')).toBeInTheDocument();
  });

  test('search can be turned off entirely', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        searchable={false}
      />,
    );
    expect(screen.queryByRole('searchbox', { name: 'Search' })).not.toBeInTheDocument();
  });

  test('a custom searchPlaceholder is used', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        searchPlaceholder="Search tracking…"
      />,
    );
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveAttribute(
      'placeholder',
      'Search tracking…',
    );
  });

  test('sorting a column flips aria-sort and reorders the rows', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={COLUMNS} rows={PARCELS} rowKey={rowKey} caption="Shipments" />);

    const header = within(table()).getByRole('button', { name: /Tracking/ });
    expect(header.closest('th')).not.toHaveAttribute('aria-sort');

    await user.click(header);
    expect(header.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    const first = within(bodyRows()[0] as HTMLElement).getAllByRole('cell')[0];
    expect(first).toHaveTextContent('ZZ1001');

    await user.click(header);
    expect(header.closest('th')).toHaveAttribute('aria-sort', 'descending');
    const firstDesc = within(bodyRows()[0] as HTMLElement).getAllByRole('cell')[0];
    expect(firstDesc).toHaveTextContent('ZZ1003');
  });

  test('sorts numerically on a money column rather than lexicographically', async () => {
    // `accessor` returns `number`. A string sort would put `100000` before `900`, because
    // "100000" < "900" as text — so every COD column in the app would be ordered wrong.
    // TanStack sorts a numeric column descending first, so the ascending pass is the second
    // click; both directions are checked because a one-sided sort is the usual bug here.
    const user = userEvent.setup();
    render(<DataTable columns={COLUMNS} rows={PARCELS} rowKey={rowKey} caption="Shipments" />);

    const header = within(table()).getByRole('button', { name: /COD/ });

    await user.click(header);
    expect(header.closest('th')).toHaveAttribute('aria-sort', 'descending');
    expect(amountsInOrder()).toEqual(['৳ 1,250.50', '৳ 1,000.00', '৳ 9.00']);

    await user.click(header);
    expect(header.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    expect(amountsInOrder()).toEqual(['৳ 9.00', '৳ 1,000.00', '৳ 1,250.50']);
  });

  test('a third click clears the sort back to the original order', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={COLUMNS} rows={PARCELS} rowKey={rowKey} caption="Shipments" />);

    const header = within(table()).getByRole('button', { name: /COD/ });
    await user.click(header);
    await user.click(header);
    await user.click(header);
    expect(header.closest('th')).not.toHaveAttribute('aria-sort');
    expect(amountsInOrder()).toEqual(['৳ 1,250.50', '৳ 9.00', '৳ 1,000.00']);
  });

  test('sorting returns to the first page', async () => {
    // Sorting a filtered, second-page list without resetting leaves the merchant staring at an
    // empty page 2 with the sort silently applied to nothing.
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `p-${i}`,
      tracking: `ZZ${2000 - i}`,
      codMinor: 100,
      status: 'pending',
    }));
    const user = userEvent.setup();
    render(
      <DataTable
        columns={COLUMNS}
        rows={many}
        rowKey={rowKey}
        caption="Shipments"
        pageSizes={[10]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('11–20 of 20')).toBeInTheDocument();

    await user.click(within(table()).getByRole('button', { name: /Tracking/ }));
    expect(screen.getByText('1–10 of 20')).toBeInTheDocument();
  });

  test('paginates client-side and reports the range', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `p-${i}`,
      tracking: `ZZ${1000 + i}`,
      codMinor: 100,
      status: 'pending',
    }));
    const user = userEvent.setup();
    render(
      <DataTable
        columns={COLUMNS}
        rows={many}
        rowKey={rowKey}
        caption="Shipments"
        pageSizes={[10]}
      />,
    );

    expect(bodyRows()).toHaveLength(10);
    expect(screen.getByText('1–10 of 25')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('11–20 of 25')).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(10);

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('21–25 of 25')).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(5);
  });

  test('reports the selected ids when a row checkbox is ticked', async () => {
    const onSelectionChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        selectable
        onSelectionChange={onSelectionChange}
      />,
    );

    await user.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0] as HTMLElement);
    expect(onSelectionChange).toHaveBeenLastCalledWith(['p-1']);
  });

  test('the header checkbox selects every row on the page', async () => {
    const onSelectionChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        selectable
        onSelectionChange={onSelectionChange}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['p-1', 'p-2', 'p-3']);
  });

  test('the header checkbox goes indeterminate when some but not all rows are selected', async () => {
    // The tri-state header is the one thing in this file that cannot be done in markup. Without
    // the `indeterminate` effect the header reads "unchecked" while two rows are selected, and
    // the merchant clicks it expecting a select-all and gets a deselect instead.
    const user = userEvent.setup();
    render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        selectable
        onSelectionChange={() => {}}
      />,
    );

    await user.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0] as HTMLElement);
    expect(
      (screen.getByRole('checkbox', { name: 'Select all rows on this page' }) as HTMLInputElement)
        .indeterminate,
    ).toBe(true);
  });

  test('the header checkbox clears to checked, not indeterminate, once all are selected', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        selectable
        onSelectionChange={() => {}}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    expect(
      (screen.getByRole('checkbox', { name: 'Select all rows on this page' }) as HTMLInputElement)
        .indeterminate,
    ).toBe(false);
  });

  test('a row checkbox does not also trigger onRowClick', async () => {
    // The select cell stops propagation; without it every tick on a selectable, clickable table
    // navigates away and loses the selection.
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        selectable
        onRowClick={onRowClick}
        onSelectionChange={() => {}}
      />,
    );

    await user.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0] as HTMLElement);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  test('clicking a row fires onRowClick with that row', async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        onRowClick={onRowClick}
      />,
    );

    await user.click(screen.getByText('ZZ1002'));
    expect(onRowClick).toHaveBeenCalledWith(PARCELS[1]);
  });

  test('no row checkboxes are rendered when the table is not selectable', () => {
    render(<DataTable columns={COLUMNS} rows={PARCELS} rowKey={rowKey} caption="Shipments" />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(table()).getAllByRole('columnheader')).toHaveLength(3);
  });

  test('an error replaces the table and offers retry', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        error="Shipments could not be loaded."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('Shipments could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('an error with no retry handler offers no dead button', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        error="Boom"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  test('loading renders skeleton rows instead of data', () => {
    render(
      <DataTable columns={COLUMNS} rows={PARCELS} rowKey={rowKey} caption="Shipments" loading />,
    );
    expect(screen.queryByText('ZZ1001')).not.toBeInTheDocument();
    // One placeholder row per page slot, not per record.
    expect(bodyRows().length).toBeGreaterThan(0);
    expect(bodyRows()[0]?.textContent).toBe('');
  });

  test('loading does not show the empty state', () => {
    // `loading` with zero rows must not read as "no matching rows" — the data has not arrived.
    render(<DataTable columns={COLUMNS} rows={[]} rowKey={rowKey} caption="Shipments" loading />);
    expect(screen.queryByText('No matching rows')).not.toBeInTheDocument();
  });

  test('a column flagged defaultHidden starts hidden', () => {
    render(
      <DataTable
        columns={[
          ...COLUMNS,
          { id: 'internal', header: 'Internal', accessor: (p) => p.id, defaultHidden: true },
        ]}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
      />,
    );
    expect(within(table()).getAllByRole('columnheader')).toHaveLength(3);
    expect(screen.queryByText('Internal')).not.toBeInTheDocument();
  });

  test('the columns menu reveals a default-hidden column', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        columns={[
          { id: 'tracking', header: 'Tracking', accessor: (p) => p.tracking },
          { id: 'status', header: 'Status', accessor: (p) => p.status },
          { id: 'internal', header: 'Internal', accessor: (p) => p.id, defaultHidden: true },
        ]}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(screen.getByRole('checkbox', { name: 'Internal' }));

    // Scoped to the table: "Internal" is also the menu label, so an unscoped query matches two.
    const headers = within(table()).getAllByRole('columnheader');
    expect(headers).toHaveLength(3);
    expect(headers[2]).toHaveTextContent('Internal');
  });

  test('the columns menu entry reflects whether its column is visible', async () => {
    // The menu is the only place a merchant can find a hidden column, so its checkboxes have to
    // agree with the table. A menu that always starts checked makes "show only COD" impossible.
    const user = userEvent.setup();
    render(
      <DataTable
        columns={[
          { id: 'tracking', header: 'Tracking', accessor: (p) => p.tracking },
          { id: 'status', header: 'Status', accessor: (p) => p.status },
          { id: 'internal', header: 'Internal', accessor: (p) => p.id, defaultHidden: true },
        ]}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Columns' }));
    expect(screen.getByRole('checkbox', { name: 'Tracking' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Internal' })).not.toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Tracking' }));
    expect(screen.getByRole('checkbox', { name: 'Tracking' })).not.toBeChecked();
  });

  test('the columns menu is hidden when there is nothing worth toggling', () => {
    render(
      <DataTable
        columns={[{ id: 'tracking', header: 'Tracking', accessor: (p) => p.tracking }]}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Columns' })).not.toBeInTheDocument();
  });

  test('toolbarExtra renders in the toolbar', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        toolbarExtra={<button type="button">Export</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  test('serverPage suppresses the search box, since filtering one page reads as filtering all', () => {
    // Documented in the props and worth pinning: with `serverPage`, the built-in filter would
    // silently apply to the 25 rows that happen to be loaded.
    render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        serverPage={{ hasMore: true, canGoBack: true, onNext: () => {}, onBack: () => {} }}
      />,
    );
    expect(screen.queryByRole('searchbox', { name: 'Search' })).not.toBeInTheDocument();
  });

  test('serverPage replaces the client pager with Newer/Older', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        serverPage={{ hasMore: true, canGoBack: true, onNext: () => {}, onBack: () => {} }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Newer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Older' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Rows per page' })).not.toBeInTheDocument();
  });

  test('serverPage disables Older at the end and Newer at the start', async () => {
    const onNext = vi.fn();
    const onBack = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        serverPage={{ hasMore: false, canGoBack: true, onNext, onBack }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Older' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Newer' })).toBeEnabled();

    rerender(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        serverPage={{ hasMore: true, canGoBack: false, onNext, onBack }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Newer' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Older' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  test('serverPage reports how many rows are on this page', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        serverPage={{ hasMore: true, canGoBack: true, onNext: () => {}, onBack: () => {} }}
      />,
    );
    expect(screen.getByText('3 on this page')).toBeInTheDocument();
  });

  test('serverPage says "No results" for an empty page', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={[]}
        rowKey={rowKey}
        caption="Shipments"
        serverPage={{ hasMore: false, canGoBack: true, onNext: () => {}, onBack: () => {} }}
      />,
    );
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  test('client sorting is suppressed under serverPage', () => {
    // Sorting one page client-side reads as sorting the whole list. The header must not offer it.
    render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        serverPage={{ hasMore: true, canGoBack: true, onNext: () => {}, onBack: () => {} }}
      />,
    );
    expect(screen.queryByRole('button', { name: /Tracking/ })).not.toBeInTheDocument();
  });

  test('selection survives a re-render with a new callback identity', async () => {
    // The component deliberately holds `onSelectionChange` in a ref. Without that, every parent
    // re-render produces a new callback and — if the effect depended on it — would re-notify,
    // which is how a selection bar ends up PATCHing on every keystroke elsewhere on the page.
    function Host() {
      const [, setTick] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setTick((t) => t + 1)}>
            Rerender
          </button>
          <DataTable
            columns={COLUMNS}
            rows={PARCELS}
            rowKey={rowKey}
            caption="Shipments"
            selectable
            onSelectionChange={onSelectionChangeSpy}
          />
        </>
      );
    }
    const onSelectionChangeSpy = vi.fn();
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0] as HTMLElement);
    expect(onSelectionChangeSpy).toHaveBeenLastCalledWith(['p-1']);
    const callsAfterSelection = onSelectionChangeSpy.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Rerender' }));
    expect(onSelectionChangeSpy).toHaveBeenCalledTimes(callsAfterSelection);
  });

  test('an uncontrolled DataTable with no onSelectionChange still selects rows without throwing', async () => {
    const user = userEvent.setup();
    render(
      <DataTable columns={COLUMNS} rows={PARCELS} rowKey={rowKey} caption="Shipments" selectable />,
    );

    await user.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0] as HTMLElement);
    expect(screen.getAllByRole('checkbox', { name: 'Select row' })[0]).toBeChecked();
  });

  test('the page-size select re-pages from the first page', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `p-${i}`,
      tracking: `ZZ${1000 + i}`,
      codMinor: 100,
      status: 'pending',
    }));
    const user = userEvent.setup();
    render(
      <DataTable
        columns={COLUMNS}
        rows={many}
        rowKey={rowKey}
        caption="Shipments"
        pageSizes={[10, 25]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('11–20 of 30')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '25');
    expect(screen.getByText('1–25 of 30')).toBeInTheDocument();
  });

  test('density changes do not alter the rendered data', () => {
    // Density is pure presentation. Asserting the cell count for both keeps the two branches
    // honest without coupling the test to padding classes.
    const { rerender } = render(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        density="compact"
      />,
    );
    expect(within(table()).getAllByRole('cell')).toHaveLength(9);

    rerender(
      <DataTable
        columns={COLUMNS}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
        density="comfortable"
      />,
    );
    expect(within(table()).getAllByRole('cell')).toHaveLength(9);
  });

  test('aligns are applied per column, right for money', () => {
    render(<DataTable columns={COLUMNS} rows={PARCELS} rowKey={rowKey} caption="Shipments" />);
    const headers = within(table()).getAllByRole('columnheader');
    expect(headers[1]).toHaveClass('text-right');
    expect(headers[0]).toHaveClass('text-left');
  });

  test('a width on a column reaches the header cell', () => {
    render(
      <DataTable
        columns={[
          {
            id: 'tracking',
            header: 'Tracking',
            accessor: (p) => p.tracking,
            width: '200px',
          },
          ...COLUMNS.slice(1),
        ]}
        rows={PARCELS}
        rowKey={rowKey}
        caption="Shipments"
      />,
    );
    // Asserted on the raw attribute: jsdom resolves `12rem` to `192px` inside `toHaveStyle`,
    // which would make the failure message about units rather than about the prop not landing.
    expect(within(table()).getAllByRole('columnheader')[0]).toHaveAttribute(
      'style',
      'width: 200px;',
    );
  });

  test('a column with no width carries no inline style', () => {
    render(<DataTable columns={COLUMNS} rows={PARCELS} rowKey={rowKey} caption="Shipments" />);
    expect(within(table()).getAllByRole('columnheader')[0]).not.toHaveAttribute('style');
  });

  test('renders every record without a key collision on duplicated values', () => {
    // `rowKey` is the identity source. Two rows that happen to share every rendered value must
    // still both render — the classic `rowKey: () => row.tracking` bug when tracking collides.
    const dupes: ReadonlyArray<Parcel> = [
      { id: 'a', tracking: 'ZZ1', codMinor: 500, status: 'pending' },
      { id: 'b', tracking: 'ZZ1', codMinor: 500, status: 'pending' },
    ];
    render(<DataTable columns={COLUMNS} rows={dupes} rowKey={(p) => p.id} caption="Shipments" />);
    expect(bodyRows()).toHaveLength(2);
  });
});
