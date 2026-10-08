import { describe, expect, it } from 'vitest';
import { isTrustedRequestId, resolveRequestId } from './request-id.ts';

/**
 * The inbound header is attacker-controlled, so these assertions are the security property:
 * a rejected value must be REPLACED, never trimmed into shape.
 */

describe('resolveRequestId', () => {
  it('keeps a well-formed inbound id, so a proxy and the log agree', () => {
    expect(resolveRequestId('abc-123_XYZ')).toBe('abc-123_XYZ');
    expect(resolveRequestId('a')).toBe('a');
  });

  it('mints one when there is no header', () => {
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId(null)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ['a newline, which forges a log line', 'abc\nGET /x 200'],
    ['a carriage return', 'abc\rX-Injected: 1'],
    ['a terminal escape', 'abc[31mred'],
    ['a space', 'abc def'],
    ['an overlong value', 'a'.repeat(65)],
    ['an empty string', ''],
    ['a non-string', 42],
  ])('replaces %s', (_label, hostile) => {
    const resolved = resolveRequestId(hostile);
    expect(resolved).not.toBe(hostile);
    expect(resolved).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(isTrustedRequestId(resolved)).toBe(true);
  });

  it('rejects rather than sanitises — a truncated forgery is still a forgery', () => {
    // Trimming 'abc def' to 'abcdef' would produce an id the attacker chose. Replacing it does not.
    expect(resolveRequestId('abc def')).not.toBe('abcdef');
  });

  it('two requests without a header get different ids', () => {
    expect(resolveRequestId(undefined)).not.toBe(resolveRequestId(undefined));
  });
});
