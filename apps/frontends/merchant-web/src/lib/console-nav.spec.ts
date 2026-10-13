import { describe, expect, test } from 'vitest';
import { activeLink } from './console-nav.ts';

/**
 * Which row of the sidebar is lit.
 *
 * Extracted from the layout because the rule is one line of logic whose bug is a screenshot: on
 * `/app/shipments/new` both the list and the create form were highlighted, so the sidebar said "you
 * are in two places" on a screen you can only be in one of.
 */

const LINKS = [
  { href: '/app' },
  { href: '/app/shipments' },
  { href: '/app/shipments/new' },
  { href: '/app/shipments/bulk' },
  { href: '/app/analytics' },
  { href: '/app/settlements' },
];

describe('activeLink', () => {
  test('lights the overview on the overview', () => {
    expect(activeLink('/app', LINKS)).toBe('/app');
  });

  test('the overview does not stay lit on a sub-screen', () => {
    // `/app` is the parent of everything else. If it matched by prefix it would light on every screen
    // in the console, which is how a sidebar ends up with six highlighted rows.
    expect(activeLink('/app/shipments', LINKS)).toBe('/app/shipments');
    expect(activeLink('/app/settlements', LINKS)).toBe('/app/settlements');
  });

  test('a child screen lights its own row, and only its own', () => {
    // The bug: both rows were lit, because the parent matched by prefix and the child matched
    // exactly, and nothing said only one of them could win.
    expect(activeLink('/app/shipments/new', LINKS)).toBe('/app/shipments/new');
    expect(activeLink('/app/shipments/bulk', LINKS)).toBe('/app/shipments/bulk');
  });

  test('a detail screen lights the list it belongs to', () => {
    expect(activeLink('/app/shipments/ZP-1', LINKS)).toBe('/app/shipments');
    expect(activeLink('/app/settlements/SET-1', LINKS)).toBe('/app/settlements');
  });

  test('a trailing segment must be a segment', () => {
    // Prefix matching without the slash boundary lights `/app/shipments` for `/app/shipmentsarchive`
    // and, worse, would light it for any future sibling whose name starts with the same letters.
    expect(activeLink('/app/shipmentsarchive', LINKS)).toBeUndefined();
  });

  test('an unknown path lights nothing', () => {
    // Better than lighting the overview: a page that does not exist should not claim to be a page you
    // can see.
    expect(activeLink('/app/nope', LINKS)).toBeUndefined();
  });

  test('a trailing slash is the same page', () => {
    expect(activeLink('/app/shipments/', LINKS)).toBe('/app/shipments');
  });

  test('the deepest match wins whatever order the links arrive in', () => {
    // Shuffled on purpose: the rule is about which path is longer, not about the array being sorted.
    const shuffled = [...LINKS].reverse();
    expect(activeLink('/app/shipments/new', shuffled)).toBe('/app/shipments/new');
  });
});
