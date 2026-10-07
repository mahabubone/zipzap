import type { BadgeProps } from '@zipzap/ui';

/** `2026-10-07T16:39:47.960Z` → `7 Oct 2026, 22:39`. Fixed locale + fixed zone
 *  so a screenshot taken today still reads correctly tomorrow. */
export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dhaka',
  }).format(new Date(iso));
}

/** `IN_TRANSIT` → `In transit`. */
export function humanStatus(status: string): string {
  const lower = status.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

type Tone = NonNullable<BadgeProps['tone']>;

const SUCCESS = new Set([
  'DELIVERED',
  'RETURNED',
  'COMPLETED',
  'SETTLED',
  'COD_COLLECTED',
  'AVAILABLE',
]);
const DANGER = new Set(['CANCELLED', 'LOST', 'DAMAGED', 'DELIVERY_FAILED', 'FAILED', 'SUSPENDED']);
const WARNING = new Set(['ON_HOLD', 'RETRY_SCHEDULED', 'EXCEPTION', 'RETURN_INITIATED']);

/** Status → badge tone. Grouped by what an operator must act on, not by hue. */
export function statusTone(status: string): Tone {
  if (SUCCESS.has(status)) return 'success';
  if (DANGER.has(status)) return 'danger';
  if (WARNING.has(status)) return 'warning';
  if (status === 'CREATED' || status === 'DRAFT' || status === 'REQUESTED') return 'neutral';
  return 'info';
}

/** Integer minor units from the API's decimal string. Safe because the value is
 *  an integer — `Number` is exact below 2^53 and nothing here exceeds it. */
export function minorOf(decimalString: string): number {
  return Number(decimalString);
}
