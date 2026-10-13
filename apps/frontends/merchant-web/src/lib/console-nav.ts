/**
 * Which row of the sidebar is lit on a given path.
 *
 * Lives here rather than in the layout because the rule is one line of logic whose failure is a
 * screenshot: on `/app/shipments/new` both the list and the create form were highlighted, so the
 * sidebar said "you are in two places" on a screen you can only be in one of. The comment beside the
 * old ternary claimed this was handled, and the screenshot said otherwise — which is the argument for
 * having the rule in a tested function rather than in an expression somebody reads at a glance.
 *
 * Framework-free on purpose: no React, no router, so the answer is a pure function of two strings.
 */
export interface NavLink {
  readonly href: string;
}

/**
 * The single href that should be lit, or `undefined` for a path that belongs to no nav item.
 *
 * Two rules, and the second is the one that was missing:
 *
 * 1. `/app` matches only itself. Every other item is a descendant of it, so a prefix test would light
 *    the overview on every screen in the console.
 * 2. The **deepest** matching link wins. A prefix test lights `/app/shipments` for
 *    `/app/shipments/new`, and an exact test on the child does not take the parent's match away — so
 *    two rows lit unless something compares them.
 */
export function activeLink(pathname: string, links: ReadonlyArray<NavLink>): string | undefined {
  let best: string | undefined;
  let bestLength = -1;

  for (const link of links) {
    // The slash boundary matters: without it `/app/shipments` would light for `/app/shipmentsarchive`,
    // and would light for any future sibling sharing a prefix.
    const matches =
      link.href === '/app'
        ? pathname === '/app'
        : pathname === link.href ||
          pathname === `${link.href}/` ||
          pathname.startsWith(`${link.href}/`);
    if (matches && link.href.length > bestLength) {
      best = link.href;
      bestLength = link.href.length;
    }
  }

  return best;
}
