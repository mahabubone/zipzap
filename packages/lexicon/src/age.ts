/**
 * How old something is, in the one vocabulary this product uses.
 *
 * The rider app said `4m ago`, the hub console said `4 min ago`, and the two were on the same delivery
 * at the same moment — one a rider reads with a thumb while walking, the other an operator reads on a
 * desk. "m" is fine in a chat client and unreadable on a loading dock at 6am. It is the kind of
 * difference nobody reports and everybody absorbs.
 *
 * Rounds rather than truncates, because a truncation says "0 min ago" for something that happened
 * forty-five seconds ago, which is a lie in the direction that matters: it reads as *nothing has
 * happened* when something has.
 */

/** Seconds since `iso`, never negative — a device clock behind the server's is a fact of life. */
export function ageSeconds(iso: string, now: number = Date.now()): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.round((now - then) / 1000));
}

/**
 * `just now` · `4 min ago` · `3 h ago` · `2 d ago`.
 *
 * A loading dock does not want a date picker, and a recipient on a phone does not want a timestamp
 * they have to read twice. Precision beyond "days" is noise at every distance this is read from.
 *
 * An unparseable date is `just now` rather than an empty string: the alternative on the rider's list
 * was a blank where an age should be, which reads as a layout bug rather than a missing value.
 */
export function formatAge(iso: string, now: number = Date.now()): string {
  const seconds = ageSeconds(iso, now);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
