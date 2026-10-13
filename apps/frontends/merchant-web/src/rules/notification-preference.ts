/**
 * The optimistic update for a notification toggle, as a pure function.
 *
 * Extracted from the screen because the bug it fixes was invisible in place: the inline version
 * mapped over *every* row with the same `enabled`, so tapping one switch moved all three. The
 * server only persisted the row that was tapped, so the screen then disagreed with the database
 * for the other two — and the screenshot that caught it (`app_notifications_muted`) showed all
 * three off while `merchant_preferences` still had two enabled.
 *
 * Pure, so it is testable without a browser and without React. `rules/` convention from
 * AGENTS.md: framework-free, and the checker on the directory name is what keeps it that way.
 */

export interface PreferenceRow {
  readonly eventType: string;
  readonly templateName: string;
  readonly enabled: boolean;
  readonly isDefault: boolean;
}

/**
 * Applies a toggle to one row and leaves the others alone.
 *
 * `isDefault` follows `enabled`, which is what the copy renders: "On — default" when the merchant
 * has taken no action, "On" when they have turned it back on themselves. That distinction is the
 * whole reason the field exists, and an update that leaves it stale shows "On — default" for a
 * preference the merchant explicitly restored.
 */
export function applyToggle(
  rows: readonly PreferenceRow[],
  eventType: string,
  enabled: boolean,
): readonly PreferenceRow[] {
  return rows.map((row) =>
    row.eventType === eventType ? { ...row, enabled, isDefault: enabled } : row,
  );
}

/**
 * Reverts one row, used when the save fails.
 *
 * The inverse of `applyToggle` on the same row only — reverting every row would undo toggles the
 * merchant made while the request was in flight, which is a worse failure than the save that
 * started it.
 */
export function revertToggle(
  rows: readonly PreferenceRow[],
  eventType: string,
  previous: boolean,
): readonly PreferenceRow[] {
  return applyToggle(rows, eventType, previous);
}
