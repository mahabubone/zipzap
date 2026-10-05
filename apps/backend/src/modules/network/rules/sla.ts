/**
 * SLA estimation — timezone- and holiday-aware. Phase 5 rung 3.
 *
 * Pure functions, zero framework coupling: no DB access, no network module import, no framework
 * types. The entire computation is `estimateDelivery`; everything else is the tiny piece it
 * composes.
 *
 * Workweek: Sunday-Thursday (Bangladesh). `estimatedDays` from the coverage row counts business
 * days forward from the dispatch date; holidays are skipped; if the current moment is past the
 * pickup cutoff the dispatch slides to the next business day.
 */

export const DHAKA_TIMEZONE = 'Asia/Dhaka' as const;
export const BANGLADESH_WORKDAYS = [0, 1, 2, 3, 4] as const; // 0=Sun .. 4=Thu
export const DEFAULT_CUTOFFS = { pickup: '18:00', delivery: '20:00' } as const;

export interface Holiday {
  readonly date: string; // yyyy-mm-dd in Asia/Dhaka
  readonly reason: string;
}

export interface ZoneCutoffs {
  readonly zone: string;
  readonly pickupCutoff: string | null;
  readonly deliveryCutoff: string | null;
}

export interface SLAResult {
  /** Midnight UTC — the parcel is due by end of this date in Asia/Dhaka. */
  readonly estimatedDate: Date;
  readonly businessDaysInFlight: number;
  readonly pickupShifted: boolean;
  readonly skippedHolidays: readonly string[]; // deduped reasons crossed while counting
}

export interface SLAError {
  readonly message: string;
}

/** Parse a `Date` into year/month/day in Asia/Dhaka. */
function dhakaParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DHAKA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value ?? new Date().getFullYear()),
    month: Number(parts.find((p) => p.type === 'month')?.value ?? 1),
    day: Number(parts.find((p) => p.type === 'day')?.value ?? 1),
  };
}

function dhakaTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DHAKA_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hh}:${mm}`;
}

/** Iso date yyyy-mm-dd in Asia/Dhaka (works at midnight UTC == midnight Dhaka). */
export function dateKey(date: Date): string {
  const { year, month, day } = dhakaParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isHoliday(date: Date, holidays: readonly Holiday[]): boolean {
  return holidays.some((h) => h.date === dateKey(date));
}

export function isWorkDay(date: Date, holidays: readonly Holiday[]): boolean {
  const dow = date.getUTCDay(); // 0=Sun..6=Sat; UTC and Dhaka agree at midnight
  return BANGLADESH_WORKDAYS.includes(dow as 0 | 1 | 2 | 3 | 4) && !isHoliday(date, holidays);
}

/** First workday on or after `date`. */
export function nextWorkDay(date: Date, holidays: readonly Holiday[]): Date {
  let d = floorDhakaDate(date);
  while (!isWorkDay(d, holidays)) {
    d = nextDay(d);
  }
  return d;
}

/** First workday strictly after `date`. */
function nextBusinessDay(date: Date, holidays: readonly Holiday[]): Date {
  return nextWorkDay(nextDay(date), holidays);
}

function nextDay(date: Date): Date {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}

/** `now` floored to midnight of today in Asia/Dhaka. */
export function floorDhakaDate(date: Date): Date {
  const { year, month, day } = dhakaParts(date);
  return new Date(Date.UTC(year, month - 1, day));
}

function holidaysBetween(a: Date, b: Date, holidays: readonly Holiday[]): readonly Holiday[] {
  const out: Holiday[] = [];
  let d = nextDay(a);
  while (d.getTime() < b.getTime()) {
    if (isHoliday(d, holidays)) {
      const found = holidays.find((h) => h.date === dateKey(d))!;
      if (!out.includes(found)) {
        out.push(found);
      }
    }
    d = nextDay(d);
  }
  return out;
}

export function estimateDelivery(
  now: Date,
  estimatedDays: number,
  holidays: readonly Holiday[],
  cutoffs: ZoneCutoffs,
): SLAResult {
  if (estimatedDays < 0) {
    throw new Error(`estimatedDays must be non-negative, got ${estimatedDays}`);
  }

  const today = floorDhakaDate(now);
  const nowTime = dhakaTime(now);
  const pickupCutoff = cutoffs.pickupCutoff ?? DEFAULT_CUTOFFS.pickup;
  const deliveryCutoff = cutoffs.deliveryCutoff ?? DEFAULT_CUTOFFS.delivery;

  let dispatchDate = today;
  let shifted = false;

  if (!isWorkDay(today, holidays)) {
    dispatchDate = nextWorkDay(today, holidays);
    shifted = true;
  } else if (nowTime > pickupCutoff) {
    dispatchDate = nextWorkDay(nextDay(today), holidays);
    shifted = true;
  } else if (estimatedDays === 0 && nowTime > deliveryCutoff) {
    dispatchDate = nextWorkDay(today, holidays);
    shifted = true;
  }

  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const h of holidaysBetween(today, dispatchDate, holidays)) {
    const key = `${h.date}|${h.reason}`;
    if (!seen.has(key)) {
      seen.add(key);
      skipped.push(h.reason);
    }
  }

  let d = dispatchDate;
  for (let i = 0; i < estimatedDays; i++) {
    const before = d;
    d = nextBusinessDay(d, holidays);
    for (const h of holidaysBetween(before, d, holidays)) {
      if (!skipped.includes(h.reason)) {
        skipped.push(h.reason);
      }
    }
  }

  return {
    estimatedDate: d,
    businessDaysInFlight: estimatedDays,
    pickupShifted: shifted,
    skippedHolidays: skipped,
  };
}
