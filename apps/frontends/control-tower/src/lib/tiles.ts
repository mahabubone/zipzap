/**
 * Tile loading, and knowing when to stop trying.
 *
 * The tile server is someone else's uptime. An ops console in a Dhaka NOC whose map is a grey void
 * because a CDN in Frankfurt is down is *worse than useless* — the numbers are in the same screen —
 * so the rule here is blunt: **markers are drawn by us, tiles are decoration, and the moment tiles
 * stop arriving the map says so and offers the list.**
 *
 * Three failure shapes, and they need different handling:
 *
 * - **A single failed tile** — one edge blip. Counted, retried once, and otherwise ignored. Falling
 *   back to a list because one of nine tiles 404'd would be absurd.
 * - **Every tile failing** — the CDN is down or the network dropped. This is the fallback case, and
 *   it must be automatic, not a button an operator has to find.
 * - **Tiles never requested** — offline before any load. Indistinguishable from "still loading" unless
 *   we count attempts, which is why `TileState` tracks them separately from successes.
 *
 * ponytail: one retry, no exponential backoff, no tile caching. A retry storm against a CDN that is
 * already down is the third way to make an outage worse. Add backoff when there is a second consumer.
 */

export type TileVerdict = 'ok' | 'failed';

export interface TileOutcome {
  readonly url: string;
  readonly verdict: TileVerdict;
}

/** Fraction of tiles that must fail before the map gives up. One bad tile is not an outage. */
export const FALLBACK_THRESHOLD = 0.5;

export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/**
 * Decide whether the tile layer has failed, from the outcomes seen so far.
 *
 * Returns false while tiles are still arriving, so the map does not flash a list during a normal cold
 * load. `MIN_TILES_FOR_VERDICT` is what makes "all 4 tiles failed" different from "1 of 4 finished and
 * 3 are still in flight".
 */
export function tilesHaveFailed(outcomes: readonly TileOutcome[], minTiles = 4): boolean {
  if (outcomes.length < minTiles) return false;
  const failed = outcomes.filter((o) => o.verdict === 'failed').length;
  return failed / outcomes.length >= FALLBACK_THRESHOLD;
}

export function tilesPending(outcomes: readonly TileOutcome[], expected: number): boolean {
  return outcomes.length < expected;
}
