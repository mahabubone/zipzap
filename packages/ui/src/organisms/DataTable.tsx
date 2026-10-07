import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { Skeleton } from '../atoms/Skeleton.tsx';
import { Button } from '../atoms/Button.tsx';
import { EmptyState } from '../molecules/EmptyState.tsx';
import { ErrorState } from '../molecules/ErrorState.tsx';
import { Pagination } from '../molecules/Pagination.tsx';
import { SearchInput } from '../molecules/SearchInput.tsx';
import { Dropdown, DropdownCheck, DropdownLabel } from '../molecules/Dropdown.tsx';
import { cx } from '../lib/cx.ts';

const SELECT = 'select';

export interface DataTableColumn<Row> {
  readonly id: string;
  readonly header: ReactNode;
  /** Custom renderer. Defaults to the `accessor` value when omitted. */
  readonly cell?: (row: Row) => ReactNode;
  /** Plain value used for sorting, the global filter, and the default cell. Omit it
   *  for display-only columns (action menus) — those are then neither sortable nor
   *  searchable, and `cell` becomes required. */
  readonly accessor?: (row: Row) => string | number;
  readonly sortable?: boolean;
  readonly searchable?: boolean;
  readonly align?: 'left' | 'right';
  readonly width?: string;
  readonly defaultHidden?: boolean;
}

export interface DataTableProps<Row> {
  readonly columns: ReadonlyArray<DataTableColumn<Row>>;
  readonly rows: ReadonlyArray<Row>;
  readonly rowKey: (row: Row) => string;
  /** Announced to screen readers. Required — an unlabelled grid is unusable. */
  readonly caption: string;
  readonly searchable?: boolean;
  readonly searchPlaceholder?: string;
  readonly selectable?: boolean;
  readonly onSelectionChange?: (ids: ReadonlyArray<string>) => void;
  readonly onRowClick?: (row: Row) => void;
  readonly pageSizes?: ReadonlyArray<number>;
  readonly density?: 'compact' | 'comfortable';
  readonly toolbarExtra?: ReactNode;
  readonly loading?: boolean;
  readonly error?: string;
  readonly empty?: ReactNode;
  readonly className?: string;
}

const ALIGN: Record<'left' | 'right', string> = { left: 'text-left', right: 'text-right' };

function SortIcon({ dir }: { readonly dir: false | 'asc' | 'desc' }) {
  return (
    <span aria-hidden className="flex flex-col leading-none">
      <svg
        viewBox="0 0 8 5"
        className={cx('size-2', dir === 'asc' ? 'text-slate-700' : 'text-slate-300')}
      >
        <path d="M4 0 8 5H0z" fill="currentColor" />
      </svg>
      <svg
        viewBox="0 0 8 5"
        className={cx('mt-0.5 size-2', dir === 'desc' ? 'text-slate-700' : 'text-slate-300')}
      >
        <path d="M4 5 0 0h8z" fill="currentColor" />
      </svg>
    </span>
  );
}

/** Client-side data grid: sort, global filter, paginate, row-select, hide columns.
 *  Every list screen should use this instead of re-wiring `Table` by hand.
 *
 *  ponytail: client-side only. When a list outgrows a few thousand rows, add
 *  `manualSorting`/`manualPagination` plus an `on*Change` fetch callback here —
 *  one place, not a fork per screen. */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  searchable = true,
  searchPlaceholder,
  selectable = false,
  onSelectionChange,
  onRowClick,
  pageSizes = [10, 25, 50, 100],
  density = 'comfortable',
  toolbarExtra,
  loading = false,
  error,
  empty,
  className,
}: DataTableProps<Row>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries(columns.filter((c) => c.defaultHidden).map((c) => [c.id, false])),
  );
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: pageSizes[0] ?? 10,
  });

  const visibleColumns = useMemo(() => columns.filter((c) => c.id !== SELECT), [columns]);

  const columnDefs = useMemo<Array<ColumnDef<Row, unknown>>>(() => {
    const defs: Array<ColumnDef<Row, unknown>> = visibleColumns.map((c) => {
      const def = {
        id: c.id,
        accessorFn: c.accessor,
        header: c.header,
        cell: (info: { row: { original: Row } }) =>
          c.cell?.(info.row.original) ?? c.accessor?.(info.row.original),
        enableSorting: c.sortable ?? c.accessor !== undefined,
        enableGlobalFilter: c.searchable ?? c.accessor !== undefined,
      };
      return def as ColumnDef<Row, unknown>;
    });

    if (selectable) {
      // Rendered by hand in the th/td so the header checkbox can go indeterminate.
      defs.unshift({
        id: SELECT,
        header: () => null,
        cell: () => null,
        enableSorting: false,
        enableGlobalFilter: false,
      } as ColumnDef<Row, unknown>);
    }
    return defs;
  }, [visibleColumns, selectable]);

  const table = useReactTable({
    data: rows as Row[],
    columns: columnDefs,
    state: { sorting, globalFilter, rowSelection, columnVisibility, pagination },
    getRowId: (row) => rowKey(row),
    enableRowSelection: selectable,
    globalFilterFn: 'includesString',
    onSortingChange: (updater) => {
      setSorting(updater);
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    },
    onGlobalFilterChange: (updater) => {
      setGlobalFilter(updater);
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    },
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const selectAllRef = useRef<HTMLInputElement>(null);
  const allSelected = table.getIsAllPageRowsSelected();
  const someSelected = table.getIsSomePageRowsSelected();
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  // Selection is derived; notify on change only, and never re-run for a new callback identity.
  const notifyRef = useRef(onSelectionChange);
  notifyRef.current = onSelectionChange;
  const selectedKey = table
    .getSelectedRowModel()
    .rows.map((r) => r.id)
    .join(',');
  useEffect(() => {
    notifyRef.current?.(selectedKey === '' ? [] : selectedKey.split(','));
  }, [selectedKey]);

  const pageRows = table.getRowModel().rows;
  const totalFiltered = table.getFilteredRowModel().rows.length;
  const cellPad = density === 'compact' ? 'px-4 py-2' : 'px-4 py-3';
  const hideable = visibleColumns.some((c) => !c.defaultHidden) && visibleColumns.length > 2;

  const toolbar = searchable || toolbarExtra || hideable;

  return (
    <div className={cx('flex flex-col gap-3', className)}>
      {toolbar ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {searchable ? (
              <SearchInput
                value={globalFilter}
                onChange={setGlobalFilter}
                placeholder={searchPlaceholder}
              />
            ) : null}
          </div>
          {toolbarExtra}
          {hideable ? (
            <Dropdown
              trigger={
                <Button variant="secondary" size="sm" className="shrink-0">
                  Columns
                </Button>
              }
            >
              <DropdownLabel>Toggle columns</DropdownLabel>
              {visibleColumns.map((c) => (
                <DropdownCheck
                  key={c.id}
                  checked={table.getColumn(c.id)?.getIsVisible() ?? true}
                  onChange={(v) => table.getColumn(c.id)?.toggleVisibility(v)}
                >
                  {typeof c.header === 'string' ? c.header : c.id}
                </DropdownCheck>
              ))}
            </Dropdown>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <ErrorState message={error} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="bg-slate-50">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-slate-200">
                  {hg.headers.map((header) => {
                    const col = visibleColumns.find((c) => c.id === header.column.id);
                    const isSelect = header.column.id === SELECT;
                    const align = col?.align ?? 'left';
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={
                          header.column.getIsSorted() === 'asc'
                            ? 'ascending'
                            : header.column.getIsSorted() === 'desc'
                              ? 'descending'
                              : undefined
                        }
                        style={col?.width ? { width: col.width } : undefined}
                        className={cx(
                          'text-xs font-medium uppercase tracking-wide text-slate-500',
                          cellPad,
                          ALIGN[align],
                        )}
                      >
                        {isSelect ? (
                          <input
                            ref={selectAllRef}
                            type="checkbox"
                            aria-label="Select all rows on this page"
                            name="select-all"
                            checked={allSelected}
                            onChange={table.getToggleAllPageRowsSelectedHandler()}
                            className="size-4 rounded border-slate-300 text-brand-600 focus-visible:outline-brand-600"
                          />
                        ) : header.column.getCanSort() ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="inline-flex items-center gap-1.5 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <SortIcon dir={header.column.getIsSorted()} />
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>

            <tbody>
              {loading
                ? Array.from({ length: pagination.pageSize }, (_, i) => (
                    <tr key={`sk-${i}`} className="border-b border-slate-50">
                      {selectable ? (
                        <td className={cellPad}>
                          <Skeleton className="size-4" />
                        </td>
                      ) : null}
                      {visibleColumns.map((c) => (
                        <td
                          key={`sk-${i}-${c.id}`}
                          className={cx(cellPad, ALIGN[c.align ?? 'left'])}
                        >
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                : pageRows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                      className={cx(
                        'border-b border-slate-50 last:border-0',
                        row.getIsSelected() && 'bg-brand-500/5',
                        onRowClick && 'cursor-pointer hover:bg-slate-50',
                      )}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const col = visibleColumns.find((c) => c.id === cell.column.id);
                        const isSelect = cell.column.id === SELECT;
                        return (
                          <td
                            key={cell.id}
                            className={cx(cellPad, ALIGN[col?.align ?? 'left'])}
                            onClick={isSelect ? (e) => e.stopPropagation() : undefined}
                          >
                            {isSelect ? (
                              <input
                                type="checkbox"
                                aria-label="Select row"
                                name="select-row"
                                checked={row.getIsSelected()}
                                onChange={row.getToggleSelectedHandler()}
                                className="size-4 rounded border-slate-300 text-brand-600 focus-visible:outline-brand-600"
                              />
                            ) : (
                              flexRender(cell.column.columnDef.cell, cell.getContext())
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
            </tbody>
          </table>

          {!loading && totalFiltered === 0 ? (
            <div className="p-4">
              {empty ?? (
                <EmptyState
                  title="No matching rows"
                  description="Adjust the search or filters and try again."
                />
              )}
            </div>
          ) : null}
        </div>
      )}

      <Pagination
        pageIndex={pagination.pageIndex}
        pageCount={table.getPageCount()}
        pageSize={pagination.pageSize}
        pageSizes={pageSizes}
        totalRows={totalFiltered}
        onPageIndexChange={(i) => setPagination((p) => ({ ...p, pageIndex: i }))}
        onPageSizeChange={(size) => setPagination({ pageIndex: 0, pageSize: size })}
      />
    </div>
  );
}
