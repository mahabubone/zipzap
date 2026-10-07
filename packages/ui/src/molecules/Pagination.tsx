import { Button } from '../atoms/Button.tsx';
import { Select } from '../atoms/Select.tsx';
import { cx } from '../lib/cx.ts';

export interface PaginationProps {
  readonly pageIndex: number;
  readonly pageCount: number;
  readonly pageSize: number;
  readonly pageSizes?: ReadonlyArray<number>;
  readonly totalRows: number;
  readonly onPageIndexChange: (index: number) => void;
  readonly onPageSizeChange?: (size: number) => void;
  readonly className?: string;
}

/** Page buttons with ellipsis: 1 … 4 5 6 … 20 */
function pageWindow(current: number, count: number): Array<number | 'gap'> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const pages = new Set<number>([0, count - 1, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 0 && p < count).sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  let prev = -1;
  for (const p of sorted) {
    if (p - prev > 1) out.push('gap');
    out.push(p);
    prev = p;
  }
  return out;
}

export function Pagination({
  pageIndex,
  pageCount,
  pageSize,
  pageSizes,
  totalRows,
  onPageIndexChange,
  onPageSizeChange,
  className,
}: PaginationProps) {
  const from = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(totalRows, (pageIndex + 1) * pageSize);

  return (
    <div className={cx('flex flex-wrap items-center justify-between gap-3 text-sm', className)}>
      <p className="text-slate-500">
        {totalRows === 0 ? 'No results' : `${from}–${to} of ${totalRows}`}
      </p>

      <div className="flex items-center gap-3">
        {onPageSizeChange && pageSizes ? (
          <label className="flex items-center gap-2 text-slate-500">
            <span>Rows</span>
            <Select
              aria-label="Rows per page"
              name="page-size"
              className="h-8 w-auto"
              value={String(pageSize)}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              options={pageSizes.map((n) => ({ value: String(n), label: String(n) }))}
            />
          </label>
        ) : null}

        {pageCount > 1 ? (
          <nav aria-label="Pagination" className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              aria-label="Previous page"
              disabled={pageIndex === 0}
              onClick={() => onPageIndexChange(pageIndex - 1)}
            >
              ‹
            </Button>
            {pageWindow(pageIndex, pageCount).map((p, i) =>
              p === 'gap' ? (
                <span key={`gap-${i}`} className="px-1 text-slate-400">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  aria-current={p === pageIndex ? 'page' : undefined}
                  onClick={() => onPageIndexChange(p)}
                  className={cx(
                    'size-8 rounded-md text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
                    p === pageIndex
                      ? 'bg-brand-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100',
                  )}
                >
                  {p + 1}
                </button>
              ),
            )}
            <Button
              variant="secondary"
              size="sm"
              aria-label="Next page"
              disabled={pageIndex >= pageCount - 1}
              onClick={() => onPageIndexChange(pageIndex + 1)}
            >
              ›
            </Button>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
