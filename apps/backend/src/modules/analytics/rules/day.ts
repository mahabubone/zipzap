/**
 * Day buckets for projections. Framework-free (rule 3).
 *
 * A "day" in every analytics projection is a Bangladesh business day, not a UTC day:
 * events land in `merchant_daily_shipments` and friends bucketed by the Asia/Dhaka
 * calendar date. Same rule as `network/rules/sla.ts` `dateKey` — duplicated rather
 * than imported so analytics has no compile-time edge on the network module
 * (cross-module communication is services and events, docs/domains/analytics.md).
 */

export const ANALYTICS_TIMEZONE = 'Asia/Dhaka';

/** Iso date `yyyy-mm-dd` of the instant, in Asia/Dhaka. */
export function dayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ANALYTICS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}
