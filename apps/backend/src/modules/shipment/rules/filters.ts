/**
 * Shipment list filters: parse, validate, and turn into bound SQL fragments.
 *
 * Framework-free by rule 3 — no @nestjs, no typeorm, no class-validator. This
 * file decides what a filter means; the repository decides how to ask for it.
 *
 * Two decisions are load-bearing and easy to get wrong:
 *
 * 1. A bad filter is refused, never ignored. Falling back to "no filter" would
 *    show the merchant their whole account while the filter bar reads as if it
 *    had worked. Every bad field is named at once, so one round trip fixes them.
 * 2. A bare `yyyy-mm-dd` is midnight in Asia/Dhaka, NOT UTC. Six hours off is
 *    the difference between a merchant seeing the parcels they created this
 *    morning and seeing none of them. `to` includes its whole final day, because
 *    a range that silently excludes the day the merchant selected is the worst
 *    kind of wrong — the list looks plausible.
 */

import { SHIPMENT_STATUSES, type ShipmentStatus } from './state-machine.ts';

/** No daylight saving since 2009, so this offset is exact, not an approximation. */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface ShipmentFilters {
  /** One or more. A single value is the common case, but a merchant thinks in
   *  groups — "in transit" is DISPATCHED, IN_TRANSIT and AT_DESTINATION_HUB — and
   *  forcing them to OR three checkboxes is a filter they will not use. Comma
   *  separated: `?status=DISPATCHED,IN_TRANSIT`. */
  readonly statuses: readonly ShipmentStatus[] | null;
  readonly zone: string | null;
  /** Search across tracking code and both phones. */
  readonly search: string | null;
  /** Inclusive lower bound, `yyyy-mm-dd` in Asia/Dhaka. */
  readonly from: string | null;
  /**
   * Inclusive last day, `yyyy-mm-dd` in Asia/Dhaka. The repository compares
   * `created_at < to + 1 day` — an exclusive upper bound is the only way to
   * include the final day without leaking into the next.
   */
  readonly to: string | null;
}

export const NO_FILTERS: ShipmentFilters = {
  statuses: null,
  zone: null,
  search: null,
  from: null,
  to: null,
};

export type FilterParse =
  | { readonly ok: true; readonly filters: ShipmentFilters }
  | { readonly ok: false; readonly issues: ReadonlyArray<{ path: string; message: string }> };

/** Longest accepted search term. Beyond this a caller is not searching, and the
 *  `ILIKE` is a scan dressed as a lookup. */
const MAX_SEARCH = 80;
const MAX_ZONE = 80;

function isShipmentStatus(value: string): value is ShipmentStatus {
  return (SHIPMENT_STATUSES as ReadonlyArray<string>).includes(value);
}

/** A `yyyy-mm-dd` that is real: rejects 2026-02-31, which `Date` would roll over. */
function isRealDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * The instant a Dhaka calendar day starts.
 *
 * Returned as a `Date`, not epoch milliseconds, because that is what reaches
 * PostgreSQL: `pg` renders a number as bare digits, so `1759276800000` arrives
 * as text and Postgres raises `DateTimeParseError` trying to read it as a
 * timestamp. Every date filter was a 500 until this returned a Date.
 */
export function dhakaDayStart(dateOnly: string): Date {
  return new Date(Date.parse(`${dateOnly}T00:00:00.000Z`) - DHAKA_OFFSET_MS);
}

/**
 * The instant AFTER a Dhaka calendar day ends — the exclusive `to` bound.
 *
 * `to` is inclusive of the whole day the merchant selected, and an inclusive
 * upper bound cannot be written as `<=`; this is the `from + 1 day` the
 * repository compares against. Built from `.getTime()` rather than `date + ms`,
 * which on a Date is string concatenation and silently produces a bound no
 * timestamp column will accept.
 */
export function dhakaDayEndExclusive(dateOnly: string): Date {
  return new Date(dhakaDayStart(dateOnly).getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Neutralise LIKE metacharacters in a user's search term.
 *
 * A merchant typing `100%` means those three characters, not "anything". Left
 * raw, `%` and `_` would silently widen the search — and `_` matches exactly
 * one character, so `ZP_1` would return every code in the account. The backslash
 * is the default LIKE escape in PostgreSQL, so doubling it is all that is
 * needed; a merchant searching for a literal backslash still finds it.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Parse the raw query into filters.
 *
 * An unknown key is ignored here, which is a property of this function and not
 * of the endpoint: `forbidNonWhitelisted` rejects `?sortBy=weight` with a 400
 * before it ever arrives. Ignoring it is still the right default for a parser
 * that is also called directly — it just is not what a caller sees.
 */
export function parseShipmentFilters(raw: {
  readonly status?: unknown;
  readonly zone?: unknown;
  readonly q?: unknown;
  readonly from?: unknown;
  readonly to?: unknown;
}): FilterParse {
  const issues: Array<{ path: string; message: string }> = [];
  let statuses: readonly ShipmentStatus[] | null = null;
  let zone: string | null = null;
  let search: string | null = null;
  let from: string | null = null;
  let to: string | null = null;

  const rawStatus = typeof raw.status === 'string' ? raw.status.trim() : '';
  if (rawStatus !== '') {
    // Every unknown value named at once: a merchant who pasted the wrong list
    // should not fix one typo per round trip.
    const wanted = rawStatus
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s !== '');
    const unknown = [...new Set(wanted.filter((s) => !isShipmentStatus(s)))];
    if (unknown.length > 0) {
      issues.push({
        path: 'status',
        message: `unknown status ${unknown.map((s) => `"${s}"`).join(', ')}`,
      });
    } else {
      // The whole group is rejected rather than the half we understood: a
      // partial filter that silently drops statuses reads as "these are all of
      // them", which is the one thing a filter must never imply.
      statuses = [
        ...new Set(wanted.filter((value): value is ShipmentStatus => isShipmentStatus(value))),
      ];
    }
  }

  const rawZone = typeof raw.zone === 'string' ? raw.zone.trim() : '';
  if (rawZone !== '') {
    if (rawZone.length > MAX_ZONE) {
      issues.push({ path: 'zone', message: `zone must be at most ${MAX_ZONE} characters` });
    } else {
      zone = rawZone;
    }
  }

  const rawSearch = typeof raw.q === 'string' ? raw.q.trim() : '';
  if (rawSearch !== '') {
    if (rawSearch.length > MAX_SEARCH) {
      issues.push({ path: 'q', message: `search must be at most ${MAX_SEARCH} characters` });
    } else {
      search = rawSearch;
    }
  }

  for (const key of ['from', 'to'] as const) {
    const value = typeof raw[key] === 'string' ? raw[key]!.trim() : '';
    if (value === '') continue;
    if (!DATE_ONLY.test(value) || !isRealDate(value)) {
      issues.push({ path: key, message: `${key} must be a yyyy-mm-dd date` });
      continue;
    }
    if (key === 'from') from = value;
    else to = value;
  }

  // Only meaningful once both parsed; a broken `from` must not also complain
  // about the ordering.
  if (from !== null && to !== null && dhakaDayStart(from) > dhakaDayStart(to)) {
    issues.push({ path: 'from', message: 'from must not be after to' });
  }

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, filters: { statuses, zone, search, from, to } };
}
