/**
 * Placing hub labels so they can be read.
 *
 * The first version drew every hub's code at `at.x + 10, at.y + 4`. With real seed data that put
 * four labels on top of each other in Dhaka and two more in Chattogram, each one rendering as the
 * visual sum of the strings involved — which is how a screenshot ended up showing `FX-DHK-12`
 * printed through `SYL-DHK-11` with neither readable.
 *
 * This is deliberately a small greedy placer rather than a real force-directed or simulated
 * annealing layout. Two reasons:
 *
 *  1. Labels must not MOVE relative to their marker to read as belonging to it. A layout that
 *     settles labels into empty space produces a map where the text is near a square but the
 *     relationship is guesswork. Here a label either sits beside its own marker or is suppressed;
 *     it never drifts to somewhere that could plausibly belong to a different hub.
 *
 *  2. The alternative is a library, and a control tower that renders an operations screen should
 *     not fail to boot because a CDN did not answer. The whole point of the map layer is that it
 *     degrades to a list (`network-map.tsx`); a layout library would reintroduce the dependency
 *     that fallback exists to survive.
 *
 * So: try a fixed ring of candidate offsets around the marker, take the first that collides with
 * nothing already placed, and if nothing is free, drop the label and report it. Suppressed labels
 * are COUNTED and shown, never silently discarded — an operator must be able to tell the
 * difference between "this hub is not labelled" and "this hub is not there".
 */

import type { Point } from './map-projection.ts';

export type { Point };

/** A label's footprint, in the same pixel units the SVG viewBox uses. */
export interface LabelBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Placement {
  readonly x: number;
  readonly y: number;
}

export interface PlacedLabel<T> {
  readonly item: T;
  /** Where the label sits. Undefined when it was suppressed for want of room. */
  readonly at: Placement | undefined;
}

/** Roughly 11px text: 6.2px average advance for this UI font, plus a little slack. */
const CHAR_WIDTH = 6.2;
const LABEL_HEIGHT = 13;
/** Two labels need a little air between them or they read as one run-together block. */
const PADDING = 3;

/**
 * Candidate offsets, in priority order: right of the marker first (the conventional placement and
 * the one an operator's eye goes to), then progressively further out on alternating sides so that a
 * dense cluster resolves outward rather than stacking every label on the same side.
 */
const OFFSETS: readonly Placement[] = [
  { x: 10, y: 4 },
  { x: 10, y: -6 },
  { x: -10, y: 4 },
  { x: -10, y: -6 },
  { x: 0, y: -14 },
  { x: 0, y: 20 },
  { x: 22, y: 4 },
  { x: -22, y: 4 },
  { x: 22, y: -14 },
  { x: -22, y: -14 },
  { x: 0, y: -30 },
  { x: 0, y: 36 },
];

export function labelWidth(text: string): number {
  return text.length * CHAR_WIDTH;
}

/**
 * The footprint a label would occupy at a candidate anchor, in SVG coordinates.
 *
 * A negative offset means the label sits to the LEFT of its marker, so the box is measured from
 * the label's left edge — which is `anchor.x + offset.x - width`, not `anchor.x + offset.x`. The
 * caller flips the SVG `text-anchor` to match.
 */
function boxAt(anchor: Point, offset: Placement, text: string): LabelBox {
  const width = labelWidth(text);
  const x = offset.x >= 0 ? anchor.x + offset.x : anchor.x + offset.x - width;
  return {
    x: x - PADDING,
    y: anchor.y + offset.y - LABEL_HEIGHT - PADDING,
    width: width + PADDING * 2,
    height: LABEL_HEIGHT + PADDING * 2,
  };
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Place one label per marker.
 *
 * Order matters and it is the caller's: hubs are passed biggest-load-first, because the hub with
 * the most parcels waiting is the one an operator most needs to identify, and a greedy placer
 * always wins the contested spot for whoever asks first.
 */
export function placeLabels<T>(
  items: readonly T[],
  anchorOf: (item: T) => Point,
  textOf: (item: T) => string,
): { readonly placed: readonly PlacedLabel<T>[]; readonly suppressed: number } {
  const taken: LabelBox[] = [];
  // Markers themselves also claim space, so a label never lands on top of a different hub's
  // square. `text.length * 2` approximates the marker's diagonal without importing markerSize.
  const markers = items.map((item) => {
    const at = anchorOf(item);
    const r = 12;
    return { x: at.x - r, y: at.y - r, width: r * 2, height: r * 2 };
  });

  const placed: PlacedLabel<T>[] = [];
  let suppressed = 0;

  items.forEach((item, index) => {
    const anchor = anchorOf(item);
    const text = textOf(item);
    let found: Placement | undefined;

    for (const offset of OFFSETS) {
      const box = boxAt(anchor, offset, text);
      const hitsLabel = taken.some((t) => overlaps(box, t));
      // The label's own marker may be inside its box (that is the point), so only the OTHERS count.
      const hitsMarker = markers.some((m, i) => i !== index && overlaps(box, m));
      if (!hitsLabel && !hitsMarker) {
        found = offset;
        taken.push(box);
        break;
      }
    }

    if (found) placed.push({ item, at: { x: anchor.x + found.x, y: anchor.y + found.y } });
    else suppressed += 1;
  });

  return { placed, suppressed };
}
