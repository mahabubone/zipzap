import { describe, expect, it } from 'vitest';
import { clampLimit, decodeCursor, encodeCursor } from './pagination.ts';

describe('cursor pagination rules', () => {
  const ID = '6a0ad279-9a1d-49b2-80fe-fe14730c9fba';

  it('round-trips a position through an opaque cursor', () => {
    const cursor = encodeCursor({ v: 1, id: ID, createdAt: '2026-10-05T00:00:00.000Z' });
    expect(cursor).not.toContain(ID);
    const decoded = decodeCursor(cursor);
    expect(decoded).toEqual({
      ok: true,
      cursor: { v: 1, id: ID, createdAt: '2026-10-05T00:00:00.000Z' },
    });
  });

  it('rejects garbage without throwing', () => {
    expect(decodeCursor('!!!')).toEqual({
      ok: false,
      reason: 'cursor is not valid base64url JSON',
    });
    expect(decodeCursor(Buffer.from('[]').toString('base64url'))).toEqual({
      ok: false,
      reason: 'cursor must be an object',
    });
    expect(
      decodeCursor(
        Buffer.from(
          JSON.stringify({ v: 2, id: 'x', createdAt: new Date().toISOString() }),
        ).toString('base64url'),
      ),
    ).toEqual({ ok: false, reason: 'unsupported cursor version' });
    expect(
      decodeCursor(
        Buffer.from(JSON.stringify({ v: 1, id: '', createdAt: 'x' })).toString('base64url'),
      ),
    ).toMatchObject({ ok: false, reason: 'cursor id must be a UUID' });
    // A forged non-UUID id must 400, not reach Postgres as invalid_text_representation.
    expect(
      decodeCursor(
        Buffer.from(
          JSON.stringify({ v: 1, id: 'fake-id', createdAt: '2026-01-01T00:00:00.000Z' }),
        ).toString('base64url'),
      ),
    ).toEqual({ ok: false, reason: 'cursor id must be a UUID' });
  });

  it('clamps limits: default 50, max 200', () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampLimit('0')).toBe(50);
    expect(clampLimit('25')).toBe(25);
    expect(clampLimit('500')).toBe(200);
  });
});
