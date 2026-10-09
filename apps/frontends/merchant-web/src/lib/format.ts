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

/** `chattogram-metro` → `Chattogram metro`. The slug is the wire format; nobody
 *  types it and nobody should read it. */
export function zoneLabel(zone: string): string {
  const words = zone.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Integer minor units from the API's decimal string. Safe because the value is
 *  an integer — `Number` is exact below 2^53 and nothing here exceeds it. */
export function minorOf(decimalString: string): number {
  return Number(decimalString);
}

const UNITS: Record<string, number> = { BDT: 100, USD: 100, EUR: 100 };
const SYMBOLS: Record<string, string> = { BDT: '৳', USD: '$', EUR: '€' };

/** `125050` + `BDT` → `৳1,250.50`, and `-50` → `-৳0.50`. A string, for places that need money
 *  inside prose — the timeline's detail lines. Renders as a string because arithmetic on a float is
 *  exactly what rule 4 forbids; the only division here is by a constant 100.
 *
 *  The sign goes OUTSIDE the symbol. `Intl` puts it on the number, so prefixing the symbol naively
 *  yields `৳-0.50` — which reads as a corrupted taka sign followed by a stray dash, and it is the
 *  format of every correction row on every statement. Found on the reconciliation screen. */
export function formatMinor(amountMinor: number, currency: string): string {
  const formatted = new Intl.NumberFormat('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amountMinor) / (UNITS[currency] ?? 100));
  const symbol = SYMBOLS[currency] ?? '';
  return `${amountMinor < 0 ? '-' : ''}${symbol}${formatted}`.trim();
}
