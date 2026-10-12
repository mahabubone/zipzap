import { describe, expect, it } from 'vitest';
import { isLoginHandle, normalisePhone } from './phone.ts';

/**
 * A rider signs in once per shift, at a depot, possibly in a hurry. Every one of these assertions
 * is a number somebody typed that either has to keep working or has to be refused clearly.
 *
 * The failure this guards against is silent: a handle that normalises to something *different* from
 * what was typed signs a rider in as somebody else, which is the one bug in a login flow that is
 * worse than the bug of refusing them.
 */
describe('normalisePhone', () => {
  it('accepts a national Bangladesh number and returns it in E.164', () => {
    expect(normalisePhone('01712345678')).toBe('+8801712345678');
  });

  it('accepts the same number already in international form', () => {
    expect(normalisePhone('+8801712345678')).toBe('+8801712345678');
  });

  it('treats those two as the SAME handle — the whole point of normalising', () => {
    expect(normalisePhone('01712345678')).toBe(normalisePhone('+8801712345678'));
  });

  it('ignores the separators a number is written with in practice', () => {
    for (const typed of [
      '01712 345678',
      '01712-345678',
      '01712.345678',
      '01712(345)678',
      '+880 1712-345678',
      '  01712345678  ',
    ]) {
      expect(normalisePhone(typed), typed).toBe('+8801712345678');
    }
  });

  it('drops a trunk zero written in parentheses, as it is on a printed manifest', () => {
    // `+880 (0)1712-345678` is how the number appears on paper. A rider should not have to know
    // that it differs from the form on their SIM card.
    expect(normalisePhone('+880(0)1712345678')).toBe('+88001712345678');
  });

  it('refuses letters rather than repairing them', () => {
    // Stripping non-digits here would let two people into one account: `017ABC1234` and a number
    // someone meant to type would collapse onto the same unique index entry.
    expect(normalisePhone('017ABC1234')).toBeNull();
    expect(normalisePhone('0171234567a')).toBeNull();
  });

  it('refuses a bare subscriber number, because the country would be a guess', () => {
    // `1712345678` is a valid number in at least a dozen countries. Picking one would make the
    // account unreachable in every other one.
    expect(normalisePhone('1712345678')).toBeNull();
  });

  it('refuses an empty string and whitespace', () => {
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone('   ')).toBeNull();
  });

  it('refuses a number with no digits at all', () => {
    expect(normalisePhone('+')).toBeNull();
    expect(normalisePhone('()-')).toBeNull();
  });

  it('leaves another country`s number exactly as written', () => {
    // Not inferred, not mangled. The country list is narrow on purpose, but it does not get
    // number that already works.
    expect(normalisePhone('+12125550123')).toBe('+12125550123');
  });

  it('refuses something longer than a phone number can be', () => {
    // E.164 caps at 15 digits. Beyond that this is not a phone number, and truncating it would
    // silently collide two different strings.
    expect(normalisePhone('+1234567890123456')).toBeNull();
  });

  it('refuses a doubled trunk zero, which is not a number anyone is reachable on', () => {
    expect(normalisePhone('001712345678')).toBeNull();
  });
});

describe('isLoginHandle', () => {
  it('accepts an email', () => {
    expect(isLoginHandle('owner@example.com')).toBe(true);
    expect(isLoginHandle('  owner@example.com  ')).toBe(true);
  });

  it('accepts a phone in either form', () => {
    expect(isLoginHandle('01712345678')).toBe(true);
    expect(isLoginHandle('+8801712345678')).toBe(true);
  });

  it('refuses something that is neither', () => {
    expect(isLoginHandle('')).toBe(false);
    expect(isLoginHandle('   ')).toBe(false);
    expect(isLoginHandle('not a handle')).toBe(false);
    // Present but malformed: an `@` with no domain is a typo, not an address.
    expect(isLoginHandle('owner@')).toBe(false);
    expect(isLoginHandle('@example.com')).toBe(false);
  });
});
