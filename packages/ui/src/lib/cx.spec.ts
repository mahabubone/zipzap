import { describe, expect, test } from 'vitest';
import { cx } from './cx.ts';

/**
 * `cx` is four lines, so the tests are about the contract rather than the implementation:
 * falsy parts drop, everything else is joined with a single space.
 *
 * It deliberately does NOT do Tailwind conflict resolution — no `twMerge`. Two consequences the
 * callers depend on: later classes never displace earlier ones, and a caller passing
 * `className="p-4"` alongside a component's own `p-2` gets both, with CSS source order deciding.
 * These tests pin that, because swapping in `twMerge` would silently change every override in
 * the app.
 */

describe('cx', () => {
  test('joins every truthy part with a single space', () => {
    expect(cx('a', 'b', 'c')).toBe('a b c');
  });

  test('drops false, null and undefined', () => {
    expect(cx('base', false, null, undefined, 'extra')).toBe('base extra');
  });

  test('returns an empty string when nothing survives', () => {
    expect(cx()).toBe('');
    expect(cx(false, null, undefined)).toBe('');
  });

  test('keeps a lone falsy-looking string, because only real falsy values drop', () => {
    // `''` is falsy and is dropped; `'0'` is not falsy and must survive.
    expect(cx('', '0')).toBe('0');
  });

  test('does not collapse a caller override — both classes are emitted in order', () => {
    // The no-twMerge contract. `Button` always puts its base classes first, so a caller's
    // `px-8` here is the *later* class and wins on equal specificity by source order in the
    // generated stylesheet. Removing the duplicate would break that silently.
    expect(cx('px-2 text-sm', 'px-8')).toBe('px-2 text-sm px-8');
  });

  test('preserves argument order exactly', () => {
    expect(cx('first', 'second', 'third', 'fourth')).toBe('first second third fourth');
  });

  test('produces no double or leading spaces when an early part is dropped', () => {
    const result = cx(undefined, 'a', false, 'b');
    expect(result).toBe('a b');
    expect(result).not.toMatch(/^\s|\s{2}/);
  });

  test('drops the number 0 along with the other falsy values', () => {
    // The reason `filter(Boolean)` is safe rather than a trap: callers write
    // `cx('w-full', rows.length && 'w-auto')`, and at zero rows that expression is `0`. Because
    // `0` is falsy it drops, which is exactly the intent — a `0` in a class attribute would be
    // a stray token. Pinned because the *alternative* — a truthiness check that kept `0` —
    // would leak it onto every empty list in the app.
    expect(cx('w-full', 0 as unknown as false)).toBe('w-full');
    expect(cx('a', 0 as unknown as false, 'b')).toBe('a b');
  });

  test('composes the way the components actually call it', () => {
    const variant = 'bg-brand-600';
    const size = 'h-10 px-4';
    const conditional = false;
    const caller = 'w-full';

    expect(cx('inline-flex rounded-md', variant, size, conditional, caller)).toBe(
      'inline-flex rounded-md bg-brand-600 h-10 px-4 w-full',
    );
  });
});
