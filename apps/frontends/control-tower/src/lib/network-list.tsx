import { Badge, Button } from '@zipzap/ui';
import type { MapHub, MapRider } from '@zipzap/api-client';
import { isInBounds } from './map-projection.ts';

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
 *
 * ## Why this file exists separately from `network-map.tsx`
 *
 * It imports nothing from Leaflet, and that is the whole point. `network-map.tsx` reaches
 * `react-leaflet`, and Leaflet reads `window` at module scope — so importing anything from it made
 * this route un-serialisable on the server, and the ops console silently fell back to client
 * rendering on every direct visit.
 *
 * So the fallback list — the view that matters most, because it is what an operator gets when the
 * basemap is unavailable — has no browser dependency at all and is server-rendered like the rest of
 * the page.
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
