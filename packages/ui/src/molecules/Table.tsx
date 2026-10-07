import type { ReactNode } from 'react';

export interface TableColumn<Row> {
  readonly header: string;
  readonly cell: (row: Row) => ReactNode;
}

export interface TableProps<Row> {
  readonly columns: ReadonlyArray<TableColumn<Row>>;
  readonly rows: ReadonlyArray<Row>;
  readonly rowKey: (row: Row) => string;
  readonly empty?: ReactNode;
}

export function Table<Row>({ columns, rows, rowKey, empty }: TableProps<Row>) {
  if (rows.length === 0) return empty ?? null;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            {columns.map((c) => (
              <th key={c.header} className="px-4 py-3">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-slate-50 last:border-0">
              {columns.map((c) => (
                <td key={c.header} className="px-4 py-3">
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
