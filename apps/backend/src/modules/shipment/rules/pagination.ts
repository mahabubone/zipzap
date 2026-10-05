/**
 * Cursor pagination rules. Framework-free: no @nestjs, no typeorm.
 *
 * One decision: encode a position in a total order as an opaque cursor, and
 * decode it back — rejecting garbage with a named failure, never a SQL error.
 *
 * The cursor is deliberately UNSIGNED. A forged cursor buys nothing: every
 * list query is scoped to the caller's merchant_id, so a hand-crafted cursor
 * only repositions within your own list. The merchant scope is the security
 * boundary, not the cursor — signing would add a secret for no threat.
 * See docs/api/pagination.md (it says "sign it"; the threat model says why not).
 */

export interface PageCursor {
  readonly v: 1;
  readonly id: string;
  readonly createdAt: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CursorDecode =
  | { readonly ok: true; readonly cursor: PageCursor }
  | { readonly ok: false; readonly reason: string };

/** Position -> opaque cursor. base64url of the JSON, no padding. */
export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Opaque cursor -> position. Garbage in, named failure out — never an exception. */
export function decodeCursor(raw: string): CursorDecode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'cursor is not valid base64url JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'cursor must be an object' };
  }
  const { v, id, createdAt } = parsed as Record<string, unknown>;
  if (v !== 1) return { ok: false, reason: 'unsupported cursor version' };
  // ids are UUIDs: anything else reaches Postgres as `invalid_text_representation`
  // and surfaces as a 500. A forged id is in-scope (unsigned cursors) but must 400.
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    return { ok: false, reason: 'cursor id must be a UUID' };
  }
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
    return { ok: false, reason: 'cursor createdAt must be an ISO timestamp' };
  }
  return { ok: true, cursor: { v: 1, id, createdAt } };
}

/** Limit clamp: default 50, max 200, per docs/api/pagination.md. */
export function clampLimit(raw: unknown): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return 50;
  return Math.min(parsed, 200);
}
