/**
 * Time, in Asia/Dhaka, on surfaces that have `Intl`.
 *
 * ## Why this is not in `@zipzap/lexicon`
 *
 * Because the rider app cannot use it. Hermes' `Intl` support is partial, and a timezone-aware
 * formatter that works on a browser and quietly misbehaves on a handset is worse than no shared
 * formatter at all — so the words and the integer arithmetic went into the lexicon, and the
 * locale-dependent presentation stayed here.
 *
 * The split is deliberate and one-directional: `@zipzap/lexicon` knows nothing about dates or
 * `Intl`, so it can be imported by anything, including a React Native bundle.
 *
 * ## Why Asia/Dhaka, pinned
 *
 * The network runs on Dhaka time. A work list that shifts with the reader's laptop is a work list
 * that cannot be compared with yesterday's screenshot — and, worse, an operations manager in
 * Chattogram and a merchant in Sylhet reading the same instant in two different timezones is a
 * disagreement about facts.
 */

/** The network's timezone. Every timestamp in the product is in it, on purpose. */
const TIMEZONE = 'Asia/Dhaka';

/** `2026-10-07T16:39:47.960Z` → `7 Oct 2026, 22:39`. Fixed locale, fixed zone. */
export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIMEZONE,
  }).format(new Date(iso));
}

/** `2026-10-07T16:39:47.960Z` → `22:39`. For a work list, where the date is noise. */
export function formatClock(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIMEZONE,
  }).format(new Date(iso));
}
