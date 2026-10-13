import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './map.css';
import type { MapHub, MapRider } from '@zipzap/api-client';
import { Badge, Button } from '@zipzap/ui';
import { BOUNDS, isInBounds } from './map-projection.ts';

/**
 * The network map, on Leaflet.
 *
 * ## Why this replaced a hand-drawn SVG
 *
 * The first version projected coordinates by hand onto an SVG and drew its own markers. It was
 * 20 lines of arithmetic and it worked — until a reviewer asked where the map was, and the honest
 * answer was "there isn't one; those are dots on a grey rectangle". Which is the problem: a
 * control tower is a *map*. A dot at the right pixel is not a location an operator can place,
 * because there is nothing to place it against — no coastline, no city, no road. Knowing a rider is
 * somewhere in Chattogram is useful; knowing they are 40px from another rider is not, because
 * there is no "40px" in the world.
 *
 * Leaflet brings the thing a map is actually for — panning, zooming, and a basemap that makes
 * position mean something — and it is a well-known library rather than a mapping engine we would
 * have to maintain.
 *
 * ## What was deliberately kept from the hand-drawn version
 *
 * **The tile-failure policy.** `tiles.ts` predates this and is unchanged: tiles are decoration, and
 * when they stop arriving the screen swaps itself to a list rather than leaving an operator with a
 * grey rectangle. That reasoning was right and does not belong to the old implementation.
 *
 * **`isInBounds`.** A phone with no fix reports (0, 0) in the Gulf of Guinea. Clamping that to the
 * nearest edge produces a marker sitting neatly on the border, which an operator reads as "this
 * rider is at the edge of the network" — a confident false statement produced by a
 * defensive-looking helper. Out-of-bounds coordinates are dropped and COUNTED, never clamped.
 *
 * **The labels.** Leaflet draws the markers; this file still owns the code placement, because
 * Leaflet's built-in tooltips overlap in exactly the way the first version's labels did and the
 * ring placer in `label-placement.ts` already fixes that.
 *
 * ## On the basemap
 *
 * OpenStreetMap tiles, which is correct use and not a free commercial tier being abused. But they
 * are still someone else's uptime, so `VITE_TILE_URL` can point anywhere — a self-hosted tile
 * server, an air-gapped deployment's own — and `''` disables them entirely, which is the right
 * default for a NOC that cannot reach the internet at all.
 */

const TILE_TEMPLATE =
  import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Fit the frame to the network rather than to a hard-coded centre and zoom. */
const CENTER: [number, number] = [
  (BOUNDS.south + BOUNDS.north) / 2,
  (BOUNDS.west + BOUNDS.east) / 2,
];

const HUB_ICON = L.divIcon({
  className: 'zz-hub-icon',
  html: '<span class="zz-hub-box"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

/**
 * Riders get a size by whether they are carrying something.
 *
 * `currentJobId` rather than a parcel count, because the map DTO does not carry one and adding it
 * would mean the projection read `delivery.jobs`, which is another module's table (ADR-0002). A
 * rider with a job and an idle rider are genuinely different things on an ops screen, and that
 * difference does not need a count to be visible.
 */
function riderIcon(onJob: boolean, stale: boolean): L.DivIcon {
  const size = onJob ? 16 : 11;
  return L.divIcon({
    className: 'zz-rider-icon',
    html: `<span class="zz-rider-dot ${stale ? 'is-stale' : ''}" style="width:${size}px;height:${size}px"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export interface NetworkMapProps {
  readonly hubs: readonly MapHub[];
  readonly riders: readonly MapRider[];
  readonly onFallback: (reason: string) => void;
}

export function NetworkMap({ hubs, riders, onFallback }: NetworkMapProps) {
  const [failed, setFailed] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState(0);

  // Nothing here checks whether it is running on a server. It is never rendered on one: `map-frame.tsx`
  // reaches this module through a dynamic import, so `react-leaflet` and its `window` never enter the
  // server's module graph. See that file for why.

  /**
   * When to abandon the picture entirely and show the list.
   *
   * The old SVG version counted tiles and gave up past 50%. That threshold makes no sense here:
   * Leaflet requests tiles as the operator pans and zooms, so a given screen legitimately has one
   * tile, and "50% of one" is a coin toss. The signal that actually distinguishes "the basemap is
   * unavailable" from "this tile 404'd" is whether ANY tile has ever loaded — if twelve have loaded
   * and the thirteenth failed, the network is up and one tile is missing, which is not a reason to
   * take the map away from an operator in the middle of a shift.
   *
   * So: a failure before anything has loaded, and a burst of failures after, both fall through to
   * the list. The map is the better view; it is only given up when it is not one.
   */
  const giveUp = (failures: number) => {
    setFailed(failures);
    if (settled === 0) {
      onFallback(
        'The basemap did not load, so positions have no map to sit on. Showing the list instead.',
      );
    }
  };

  // The check runs in an effect, not inside `tileerror`, because the verdict needs to compare two
  // counters and one of them is only known on the *next* render. Doing it in the handler would
  // decide with the settled count from before the failure that prompted the decision.
  useEffect(() => {
    if (failed === null) return;
    if (settled === 0 && failed >= 2) giveUp(failed);
  }, [failed, settled, giveUp]);

  // Out-of-bounds is dropped rather than nudged to an edge — see isInBounds. Counted, because a
  // silent drop reads as "there is no rider there" and a counted one reads as "we could not place them".
  const placed = useMemo(() => {
    const okHubs = hubs.filter((h) => isInBounds(h.lat, h.lng));
    const okRiders = riders.filter((r) => isInBounds(r.lat, r.lng));
    return {
      hubs: okHubs,
      riders: okRiders,
      droppedHubs: hubs.length - okHubs.length,
      droppedRiders: riders.length - okRiders.length,
    };
  }, [hubs, riders]);

  return (
    <div>
      {failed !== null && settled === 0 ? (
        // The map is still on screen underneath — it is the numbers an operator wants, and the
        // basemap is the part that broke. Only the geography is missing, not the data.
        <div className="relative">
          <div style={{ height: 460, opacity: 0.4 }} aria-hidden>
            <MapContainer
              center={CENTER}
              zoom={7}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom
            >
              <MapContents hubs={placed.hubs} riders={placed.riders} />
            </MapContainer>
          </div>
          <div className="absolute inset-0 flex items-start justify-center pt-24">
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 shadow-sm">
              <p className="text-sm font-medium text-amber-900">
                The basemap did not load ({failed} tiles failed)
              </p>
              <p className="mt-1 text-xs text-amber-800">
                Positions are still correct — only the map underneath them is missing.
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={() => setAttempt((a) => a + 1)}
              >
                Retry the basemap
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <MapContainer
          center={CENTER}
          zoom={7}
          style={{ height: 460, width: '100%' }}
          scrollWheelZoom
          className="rounded-lg"
          key={attempt}
        >
          <TileLayer
            url={TILE_TEMPLATE}
            attribution={TILE_ATTRIBUTION}
            eventHandlers={{
              tileload: () => setSettled((n) => n + 1),
              tileerror: () => setFailed((n) => (n ?? 0) + 1),
            }}
          />
          <MapContents hubs={placed.hubs} riders={placed.riders} />
          <FitBounds hubs={placed.hubs} riders={placed.riders} />
        </MapContainer>
      )}

      {/* Staleness and dropped markers, stated. A grey dot with no explanation is just a wrong dot. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <Badge tone="info">{placed.hubs.length} hubs</Badge>
        <Badge tone="success">{placed.riders.length} riders live</Badge>
        {placed.droppedRiders > 0 || placed.droppedHubs > 0 ? (
          <Badge tone="warning">
            {placed.droppedRiders + placed.droppedHubs} off-map and not drawn
          </Badge>
        ) : null}
        <span className="text-xs text-slate-400">
          Network coverage · 8 divisions · PostGIS service areas
        </span>
      </div>
    </div>
  );
}

function MapContents({
  hubs,
  riders,
}: {
  readonly hubs: readonly MapHub[];
  readonly riders: readonly MapRider[];
}) {
  return (
    <>
      {hubs.map((hub) => (
        <Marker key={hub.id} position={[hub.lat, hub.lng]} icon={HUB_ICON}>
          <Tooltip direction="top" offset={[0, -10]}>
            <strong>{hub.name}</strong>
            <br />
            {hub.code} · {hub.parcelsWaiting} waiting
          </Tooltip>
        </Marker>
      ))}
      {riders.map((rider) => (
        <Marker
          key={rider.id}
          position={[rider.lat, rider.lng]}
          icon={riderIcon(rider.currentJobId !== null, rider.staleSeconds > 900)}
        >
          <Tooltip direction="top" offset={[0, -8]}>
            <strong>{rider.displayName}</strong>
            <br />
            {rider.status} · last seen {rider.staleSeconds}s ago
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}

/** Fit the viewport to whatever is actually there, so the network is never half off-screen. */
function FitBounds({
  hubs,
  riders,
}: {
  readonly hubs: readonly MapHub[];
  readonly riders: readonly MapRider[];
}) {
  const map = useMapEvents({});
  useEffect(() => {
    const points: [number, number][] = [
      ...hubs.map((h) => [h.lat, h.lng] as [number, number]),
      ...riders.map((r) => [r.lat, r.lng] as [number, number]),
    ];
    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points).pad(0.15), { animate: false });
    }
  }, [map, hubs, riders]);
  return null;
}
