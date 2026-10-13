import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Table, type TableColumn } from './Table.tsx';

/**
 * `Table` is the unopinionated sibling of `DataTable` — no sort, no filter, no paging, just a
 * grid. Its one branch is the empty case, and that branch is a whole-component return: an empty
 * list must render *only* the caller's empty node, not a header with no rows under it, because
 * an empty table reads as "the data failed to load".
 */

interface Stop {
  readonly id: string;
  readonly zone: string;
  readonly parcels: number;
}

const ROWS: ReadonlyArray<Stop> = [
  { id: 's-1', zone: 'Dhaka', parcels: 12 },
  { id: 's-2', zone: 'Chattogram', parcels: 3 },
];

const COLUMNS: ReadonlyArray<TableColumn<Stop>> = [
  { header: 'Stop', cell: (s) => s.zone },
  { header: 'Parcels', cell: (s) => s.parcels },
];

describe('Table', () => {
  test('renders a table with the given headers', () => {
    render(<Table columns={COLUMNS} rows={ROWS} rowKey={(s) => s.id} />);
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Stop', 'Parcels']);
  });

  test('renders one row per record', () => {
    render(<Table columns={COLUMNS} rows={ROWS} rowKey={(s) => s.id} />);
    expect(screen.getAllByRole('row')).toHaveLength(1 + ROWS.length);
  });

  test('renders the cell renderer output for each column', () => {
    render(<Table columns={COLUMNS} rows={ROWS} rowKey={(s) => s.id} />);
    expect(screen.getByText('Dhaka')).toBeInTheDocument();
    expect(screen.getByText('Chattogram')).toBeInTheDocument();
  });

  test('renders a number cell as its text', () => {
    render(<Table columns={COLUMNS} rows={ROWS} rowKey={(s) => s.id} />);
    // React renders numbers as text; a caller returning `0` must still get a cell.
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  test('renders rows in the order given, without sorting them', () => {
    // `Table` deliberately does not sort. Asserting the order pins that: a caller that wanted
    // sorting reaches for `DataTable`, and a silent sort here would reorder a curated list.
    render(<Table columns={COLUMNS} rows={ROWS} rowKey={(s) => s.id} />);
    const bodyRows = [...document.querySelectorAll('tbody tr')];
    expect(within(bodyRows[0] as HTMLElement).getByText('Dhaka')).toBeInTheDocument();
    expect(within(bodyRows[1] as HTMLElement).getByText('Chattogram')).toBeInTheDocument();
  });

  test('renders an empty node for zero rows and no table at all', () => {
    render(
      <Table
        columns={COLUMNS}
        rows={[]}
        rowKey={(s) => s.id}
        empty={<div>No stops on this manifest</div>}
      />,
    );
    expect(screen.getByText('No stops on this manifest')).toBeInTheDocument();
    // The whole component returns early — an empty `<table>` with headers and no rows reads as
    // a failed load rather than an empty manifest.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('renders nothing at all for zero rows with no empty node', () => {
    const { container } = render(<Table columns={COLUMNS} rows={[]} rowKey={(s) => s.id} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders the headers for a non-empty list even if a cell renders null', () => {
    render(
      <Table
        columns={[
          { header: 'Stop', cell: () => null },
          { header: 'Parcels', cell: () => null },
        ]}
        rows={ROWS}
        rowKey={(s) => s.id}
      />,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);
  });

  test('a cell renderer can return a node, not just a string', () => {
    render(
      <Table
        columns={[{ header: 'Zone', cell: (s: Stop) => <strong>{s.zone}</strong> }]}
        rows={ROWS}
        rowKey={(s) => s.id}
      />,
    );
    expect(screen.getByText('Dhaka').tagName).toBe('STRONG');
  });

  test('rows keyed by rowKey survive a reorder', () => {
    // React reconciles by key. A `rowKey` that returned a stable id keeps DOM identity across a
    // sort or filter; one that returned the index would shuffle input focus between rows.
    const { rerender } = render(<Table columns={COLUMNS} rows={ROWS} rowKey={(s) => s.id} />);
    const firstBefore = [...document.querySelectorAll('tbody tr')][0];

    rerender(<Table columns={COLUMNS} rows={[...ROWS].reverse()} rowKey={(s) => s.id} />);
    const firstAfter = [...document.querySelectorAll('tbody tr')][0];
    expect(firstAfter).not.toBe(firstBefore);
    expect(within(firstAfter as HTMLElement).getByText('Chattogram')).toBeInTheDocument();
  });

  test('a single row renders without a key collision against the header', () => {
    render(<Table columns={COLUMNS} rows={[ROWS[0] as Stop]} rowKey={(s) => s.id} />);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
  });
});
