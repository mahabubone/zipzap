/**
 * The shipment list's filter state, as plain data.
 *
 * Framework-free so `scripts/verify-filters.mjs` can assert it without a
 * renderer — the two things that are easy to get quietly wrong here are the
 * query we build from the state, and what counts as "a filter is on" (which
 * decides whether the Clear button appears at all). Neither is worth a DOM to
 * test.
 */

export interface Filters {
  readonly q: string;
  /** A status GROUP's value from statusGroups.ts, not a raw status. */
  readonly status: string;
  readonly zone: string;
  /** `yyyy-mm-dd`, the value an `<input type="date">` gives. */
  readonly from: string;
  readonly to: string;
}

export const NO_FILTERS: Filters = { q: '', status: '', zone: '', from: '', to: '' };

/** Is anything narrowing the list? Drives the Clear button and the empty state. */
export function isFiltered(f: Filters): boolean {
  return f.q.trim() !== '' || f.status !== '' || f.zone !== '' || f.from !== '' || f.to !== '';
}

/**
 * The query to send. Empty values are omitted rather than sent blank: the
 * backend treats an empty string as absent, and a URL that reads
 * `?status=&zone=` is harder to eyeball than one that just omits them.
 */
export function shipmentQuery(
  f: Filters,
  cursor: string | null,
  limit: number,
): {
  limit: string;
  cursor?: string;
  status?: string;
  zone?: string;
  q?: string;
  from?: string;
  to?: string;
} {
  const q = f.q.trim();
  return {
    limit: String(limit),
    ...(cursor !== null ? { cursor } : {}),
    ...(f.status !== '' ? { status: f.status } : {}),
    ...(f.zone !== '' ? { zone: f.zone } : {}),
    ...(q !== '' ? { q } : {}),
    ...(f.from !== '' ? { from: f.from } : {}),
    ...(f.to !== '' ? { to: f.to } : {}),
  };
}

/**
 * The `useAsync` key. Every field that changes the result has to be in here,
 * or the screen keeps showing the previous filter's rows — which is exactly the
 * "silently applied to one page" failure `DataTable.serverPage` exists to
 * prevent, one level up.
 */
export function queryKey(f: Filters, cursor: string | null): string {
  const q = shipmentQuery(f, cursor, 0);
  // JSON, not a joined string: a separator that can appear inside a value makes
  // two different filters hash to the same key, and the symptom is a screen
  // showing the previous filter's rows with no error anywhere.
  return JSON.stringify([
    q.status ?? '',
    q.zone ?? '',
    q.q ?? '',
    q.from ?? '',
    q.to ?? '',
    cursor ?? '',
  ]);
}

/**
 * Cross-clamp the two dates so the control cannot produce a backwards range,
 * which the backend refuses with a 400. The browser's own `min`/`max` stops a
 * typed date; this stops the state from ever holding one.
 */
export function clampRange(f: Filters): Filters {
  if (f.from !== '' && f.to !== '' && f.from > f.to) {
    // Moving `to` is the lesser surprise: the merchant set `from` first and is
    // now choosing an end, so the end follows rather than the start jumping.
    return { ...f, to: f.from };
  }
  return f;
}
