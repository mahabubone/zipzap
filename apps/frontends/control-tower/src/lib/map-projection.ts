/**
 * Where the network is, as pixels.
 *
 * An equirectangular projection over a fixed Bangladesh bounding box. Deliberately not Web Mercator
 * and deliberately not a mapping library: the network is Dhaka to Chattogram to Sylhet, roughly 500km
 * of latitude, where the Mercator distortion that makes a world map look right is a rounding error.
 * A 20-line projection that cannot be misconfigured is worth more here than a tile pipeline.
 *
 * The tiles are a separate, optional layer (see `network-map.tsx`) — this file knows nothing about
 * them, which is what makes the "degrades to a list" exit check possible: the markers are drawn by
 * the app and are unaffected by whether a tile server answered.
 */

/** Bangladesh plus a margin, so Sylhet and the Cox's Bazar coast are inside the frame. */
export const BOUNDS = { west: 88.9, east: 92.7, south: 20.5, north: 25.7 };

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Latitude/longitude → pixels in a `width`×`height` frame. */
export function project(lat: number, lng: number, width: number, height: number): Point {
  const x = ((lng - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * width;
  // Screen y grows downward, latitude grows upward — so this is inverted, not clamped.
  const y = ((BOUNDS.north - lat) / (BOUNDS.north - BOUNDS.south)) * height;
  return { x, y };
}

/**
 * Whether a coordinate is inside the frame we can honestly draw.
 *
 * This replaced a `clampToFrame`, and the reason matters. Clamping a wild coordinate to the nearest
 * edge produces a marker sitting neatly on the border — which an operator reads as "this rider is at
 * the edge of the network", a confident false statement produced by a defensive-looking helper.
 * A phone with no fix reports (0, 0) in the Gulf of Guinea; the honest rendering is **no marker, and a
 * count of how many were dropped**, not a tidy dot pretending to be a location.
 */
export function isInBounds(lat: number, lng: number, margin = 0.25): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return (
    lat >= BOUNDS.south - margin &&
    lat <= BOUNDS.north + margin &&
    lng >= BOUNDS.west - margin &&
    lng <= BOUNDS.east + margin
  );
}

/** A rider marker is a dot; a hub marker is a square with a load count beside it. */
export function markerSize(parcelsWaiting: number | null): number {
  return parcelsWaiting === null ? 10 : Math.min(22, 10 + parcelsWaiting * 2);
}
/**
 * The slippy-tile indices covering the bounding box at a zoom level.
 *
 * Standard Web Mercator index maths, and it lives here rather than in the component because it is
 * pure and testable — the first draft drew `N` copies of the *same* tile URL, which looked like a
 * decorative layer and was in fact one image repeated.
 */
export function tilesForBounds(zoom: number): ReadonlyArray<{ x: number; y: number }> {
  const n = 2 ** zoom;
  const lonToX = (lng: number) => Math.floor(((lng + 180) / 360) * n);
  const latToY = (lat: number) => {
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const rad = (clamped * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  };

  const minX = lonToX(BOUNDS.west);
  const maxX = lonToX(BOUNDS.east);
  const minY = latToY(BOUNDS.north);
  const maxY = latToY(BOUNDS.south);

  const out: Array<{ x: number; y: number }> = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) out.push({ x, y });
  }
  return out;
}
