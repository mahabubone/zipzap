/**
 * Cursor-stack navigation for a server-paginated list.
 *
 * A cursor is one-way: it means "everything after this point", never "the page
 * before". So going back means remembering the cursors already used and
 * replaying them. That stack is the whole mechanism, and it is the part that is
 * easy to get wrong — hence the file, and hence the assertions in
 * `scripts/verify-cursor-stack.mjs`.
 *
 * Framework-free so it can be asserted without a renderer.
 */

/** `cursors[0]` is always null: the first page has no cursor. */
export type CursorStack = ReadonlyArray<string | null>;

export const FIRST_PAGE: CursorStack = [null];

/** The cursor for the page currently shown, or null on the first page. */
export function currentCursor(stack: CursorStack): string | null {
  return stack[stack.length - 1] ?? null;
}

/**
 * Move to older rows. `nextCursor` is the cursor the server returned for the
 * current page; null means there is nothing older, so the stack is unchanged.
 */
export function older(stack: CursorStack, nextCursor: string | null): CursorStack {
  if (nextCursor === null) return stack;
  // Appending, not replacing: the entries behind the top are how Newer walks
  // back. `currentCursor` guarantees the top is the page on screen, so there is
  // never a stale entry ahead of the cursor being appended.
  return [...stack, nextCursor];
}

/** Move to newer rows. On the first page this is a no-op, not an empty stack. */
export function newer(stack: CursorStack): CursorStack {
  return stack.length > 1 ? stack.slice(0, -1) : stack;
}

/** Human page number for display: the first page is 1. */
export function pageNumber(stack: CursorStack): number {
  return stack.length;
}
