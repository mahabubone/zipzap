import { useEffect, useMemo, useState } from 'react';
import type { MapHub, MapRider } from '@zipzap/api-client';
import { Badge, Button } from '@zipzap/ui';
import { isInBounds, markerSize, project, tilesForBounds } from './map-projection.ts';
import { tileUrl, tilesHaveFailed, type TileOutcome } from './tiles.ts';

const WIDTH = 800;
const HEIGHT = 560;

/**
 * Zoom 6 is the smallest level where Dhaka and Chattogram are distinguishable at this frame size.
 * The tile grid is computed from the bounding box rather than hard-coded, so changing `BOUNDS` or the
 * zoom cannot silently leave the layer drawing the wrong part of the world.
 */
const ZOOM = 6;
const TILES = tilesForBounds(ZOOM);
const TILE_SIZE = 256;

/**
 * The tile server is optional, and this is where that decision is made.
 *
 * A default of `''` means: request nothing, draw the map immediately, never fall back. That is the
 * right default for an air-gapped NOC and for any deployment whose tile host is not ours to name. A
 * deployment that *does* pass a template gets the failure handling below.
 */
const TILE_TEMPLATE = import.meta.env.VITE_TILE_URL ?? '';

export interface NetworkMapProps {
  readonly hubs: readonly MapHub[];
  readonly riders: readonly MapRider[];
  readonly onFallback: (reason: string) => void;
}

export function NetworkMap({ hubs, riders, onFallback }: NetworkMapProps) {
  const [outcomes, setOutcomes] = useState<readonly TileOutcome[]>([]);
  const tilesOn = TILE_TEMPLATE !== '';

  // Out-of-bounds is dropped rather than nudged to an edge — see isInBounds. Counted, because a
  // silent drop reads as "there is no rider there" and a counted one reads as "we could not place them".
  const placed = useMemo(() => {
    const okHubs = hubs.filter((h) => isInBounds(h.lat, h.lng));
    const okRiders = riders.filter((r) => isInBounds(r.lat, r.lng));
    return {
      hubs: okHubs.map((h) => ({ hub: h, at: project(h.lat, h.lng, WIDTH, HEIGHT) })),
      riders: okRiders.map((r) => ({ rider: r, at: project(r.lat, r.lng, WIDTH, HEIGHT) })),
      droppedHubs: hubs.length - okHubs.length,
      droppedRiders: riders.length - okRiders.length,
    };
  }, [hubs, riders]);

  useEffect(() => {
    if (!tilesOn) return;
    if (tilesHaveFailed(outcomes)) {
      onFallback(
        `The tile server did not answer (${outcomes.filter((o) => o.verdict === 'failed').length} of ${outcomes.length} tiles failed).`,
      );
    }
  }, [outcomes, tilesOn, onFallback]);

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full rounded-lg border border-slate-200 bg-slate-100"
        role="img"
        aria-label={`Network map: ${hubs.length} hubs, ${riders.length} riders with a position`}
      >
        {/* Tiles first, underneath. Purely decoration: every marker below is drawn by this app and
            does not depend on a single one of them loading. */}
        {tilesOn
          ? TILES.map(({ x, y }) => {
              const url = tileUrl(TILE_TEMPLATE, ZOOM, x, y);
              return (
                <image
                  key={url}
                  href={url}
                  x={0}
                  y={0}
                  width={TILE_SIZE}
                  height={TILE_SIZE}
                  opacity={0}
                  onLoad={() => settle(url, 'ok')}
                  onError={() => settle(url, 'failed')}
                />
              );
            })
          : null}

        {placed.hubs.map(({ hub, at }) => (
          <g key={hub.id} data-marker="hub">
            <rect
              x={at.x - markerSize(hub.parcelsWaiting) / 2}
              y={at.y - markerSize(hub.parcelsWaiting) / 2}
              width={markerSize(hub.parcelsWaiting)}
              height={markerSize(hub.parcelsWaiting)}
              className="fill-brand-600/80"
              rx={2}
            />
            <text x={at.x + 10} y={at.y + 4} className="fill-slate-700 text-[11px]">
              {hub.code}
              {hub.parcelsWaiting > 0 ? ` · ${hub.parcelsWaiting}` : ''}
            </text>
          </g>
        ))}

        {placed.riders.map(({ rider, at }) => (
          <circle
            key={rider.id}
            data-marker="rider"
            cx={at.x}
            cy={at.y}
            r={5}
            className={rider.staleSeconds > 900 ? 'fill-slate-400' : 'fill-emerald-600'}
          >
            <title>{`${rider.displayName} — ${rider.status}, last seen ${rider.staleSeconds}s ago`}</title>
          </circle>
        ))}
      </svg>

      {/* Staleness and dropped markers, stated. A grey dot with no explanation is just a wrong dot. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <Badge tone="info">{placed.hubs.length} hubs</Badge>
        <Badge tone="success">{placed.riders.length} riders live</Badge>
        {placed.droppedRiders > 0 || placed.droppedHubs > 0 ? (
          <Badge tone="warning">
            {placed.droppedRiders + placed.droppedHubs} off-map and not drawn
          </Badge>
        ) : null}
        {!tilesOn ? (
          <span className="text-slate-400">No tile server configured — markers only.</span>
        ) : null}
      </div>
    </div>
  );

  function settle(url: string, verdict: TileOutcome['verdict']): void {
    setOutcomes((prev) => [...prev.filter((o) => o.url !== url), { url, verdict }]);
  }
}

/** How many markers the map would have had to drop. Both views report the same figure. */
export function unplaceable(hubs: readonly MapHub[], riders: readonly MapRider[]): number {
  return (
    hubs.filter((h) => !isInBounds(h.lat, h.lng)).length +
    riders.filter((r) => !isInBounds(r.lat, r.lng)).length
  );
}

/**
 * The list the map falls back to.
 *
 * Not a spinner and not an error. An operator whose map is grey still needs to know where the riders
 * are, and a sorted table of last-seen times answers that better than a picture would have.
 */
export function NetworkList({
  hubs,
  riders,
  reason,
  onRetry,
}: {
  readonly hubs: readonly MapHub[];
  readonly riders: readonly MapRider[];
  readonly reason: string;
  readonly onRetry: () => void;
}) {
  // The same count the map states in its footer. The two views must agree: a fallback that showed 20
  // hubs while the map showed 18, with nothing explaining the difference, is a screen an operator
  // cannot trust about either number.
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-amber-900">{reason} Showing the list instead.</p>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry the map
        </Button>
      </div>

      {unplaceable(hubs, riders) > 0 ? (
        <p className="mb-3 text-sm text-slate-600">
          {unplaceable(hubs, riders)} of these sit outside the map frame and could not be drawn as
          markers. They are listed here because a list has no frame to be outside of.
        </p>
      ) : null}

      <h2 className="text-sm font-semibold text-slate-700">Riders ({riders.length})</h2>
      <ul className="mt-2 flex flex-col gap-1">
        {riders.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2"
          >
            <span className="font-medium">{r.displayName}</span>
            <span className="flex items-center gap-2 text-sm text-slate-500">
              {r.status}
              <Badge tone={r.staleSeconds > 900 ? 'warning' : 'success'}>
                {r.staleSeconds > 900 ? 'stale' : 'live'}
              </Badge>
              <span className="tabular-nums">
                {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <h2 className="mt-4 text-sm font-semibold text-slate-700">Hubs ({hubs.length})</h2>
      <ul className="mt-2 flex flex-col gap-1">
        {hubs.map((h) => (
          <li
            key={h.id}
            className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2"
          >
            <span className="font-medium">{h.name}</span>
            <span className="text-sm text-slate-500">
              {h.code} · {h.parcelsWaiting} waiting
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
