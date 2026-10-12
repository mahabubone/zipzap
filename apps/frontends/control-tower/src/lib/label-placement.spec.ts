import { describe, expect, it } from 'vitest';
import { labelWidth, placeLabels, type Point } from './label-placement.ts';

/**
 * Label collision is a geometry bug, so it is tested as geometry rather than through a rendered SVG.
 *
 * The failure this guards against was found by looking at a screenshot: four Dhaka hub codes
 * printed through each other, and an operator reading the map saw `FX-DHK-12` over `SYL-DHK-11`
 * with neither legible. Nothing about that is visible to `tsc` or to a snapshot of the component —
 * it is only visible as pixels, which is why it survived a green test suite.
 */

const at = (x: number, y: number): Point => ({ x, y });

describe('labelWidth', () => {
  it('grows with the length of the string', () => {
    expect(labelWidth('FX-DHK-1')).toBeGreaterThan(labelWidth('FX-DHK-'));
    expect(labelWidth('a longer code')).toBeGreaterThan(labelWidth('FX-DHK-1'));
    expect(labelWidth('')).toBe(0);
  });
});

describe('placeLabels', () => {
  it('places a lone label at the conventional offset, right of its marker', () => {
    const { placed, suppressed } = placeLabels(
      [{ code: 'FX-DHK-1' }],
      () => at(100, 100),
      (i) => i.code,
    );

    expect(suppressed).toBe(0);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.at).toEqual({ x: 110, y: 104 });
  });

  it('moves a colliding label instead of stacking it on the first', () => {
    // Two markers 12px apart: their labels cannot both sit to the right. The position is baked
    // into the item rather than derived from a callback index, because `placeLabels` hands
    // `anchorOf` one argument — the item — and an index the caller invented would be a
    // second source of truth for where a marker is.
    const items = [
      { code: 'FX-DHK-1', pos: at(100, 100) },
      { code: 'FX-DHK-2', pos: at(112, 100) },
    ];
    const { placed, suppressed } = placeLabels(
      items,
      (i) => i.pos,
      (i) => i.code,
    );

    expect(suppressed).toBe(0);
    expect(placed).toHaveLength(2);
    // Different positions — the whole point.
    expect(placed[0]!.at).not.toEqual(placed[1]!.at);
  });

  it('never places two labels at the same anchor, however dense the cluster', () => {
    // Eight hubs on the same point — the pathological case a real map hits when a city has
    // several sorting centres.
    const items = Array.from({ length: 8 }, (_, i) => ({ code: `FX-DHK-${i}` }));
    const { placed, suppressed } = placeLabels(
      items,
      () => at(200, 200),
      (i) => i.code,
    );

    const positions = placed.map((p) => `${p.at!.x},${p.at!.y}`);
    expect(new Set(positions).size).toBe(placed.length);
    // Suppression, not overlap, is the overflow behaviour.
    expect(placed.length + suppressed).toBe(8);
  });

  it('suppresses rather than overlaps when every offset is taken, and counts what it dropped', () => {
    // Sixty markers on one spot exhausts the offset ring, which is the behaviour the footer
    // badge exists to report.
    const items = Array.from({ length: 60 }, (_, i) => ({ code: `FX-${i}` }));
    const { placed, suppressed } = placeLabels(
      items,
      () => at(300, 300),
      (i) => i.code,
    );

    expect(suppressed).toBeGreaterThan(0);
    expect(placed.length + suppressed).toBe(60);
    expect(placed.length).toBeLessThanOrEqual(12); // the size of the offset ring
  });

  it('keeps every label within a sane distance of its own marker', () => {
    // A label that drifts far from its square reads as belonging to a different hub, which is
    // worse than an unlabelled one. This is the invariant that rules out a force-directed layout.
    const items = Array.from({ length: 10 }, (_, i) => ({
      code: `FX-DHK-${i}`,
      pos: at(400 + (i % 3) * 8, 400 + Math.floor(i / 3) * 8),
    }));
    const { placed } = placeLabels(
      items,
      (i) => i.pos,
      (i) => i.code,
    );

    expect(placed.length).toBeGreaterThan(0);
    for (const { item, at: position } of placed) {
      expect(Math.abs(position!.x - item.pos.x)).toBeLessThanOrEqual(30);
      expect(Math.abs(position!.y - item.pos.y)).toBeLessThanOrEqual(40);
    }
  });

  it('does not let a label sit on top of a different marker', () => {
    const items = [
      { code: 'A', at: at(100, 100) },
      { code: 'B', at: at(160, 100) },
    ];
    const { placed } = placeLabels(
      items,
      (i) => i.at,
      (i) => i.code,
    );

    for (const p of placed) {
      // Label for A must not cover marker B's centre, and vice versa.
      for (const other of items) {
        if (other.code === p.item.code) continue;
        const insideMarker =
          p.at!.x - 6 < other.at.x &&
          p.at!.x + labelWidth(p.item.code) + 6 > other.at.x &&
          p.at!.y - 13 < other.at.y &&
          p.at!.y + 4 > other.at.y;
        expect(insideMarker).toBe(false);
      }
    }
  });

  it('handles an empty network without inventing labels', () => {
    const { placed, suppressed } = placeLabels(
      [],
      () => at(0, 0),
      () => '',
    );
    expect(placed).toHaveLength(0);
    expect(suppressed).toBe(0);
  });
});
