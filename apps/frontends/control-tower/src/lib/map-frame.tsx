import { useEffect, useState } from 'react';
import type { MapHub, MapRider } from '@zipzap/api-client';
import { NetworkMap } from './network-map.tsx';

/**
 * The map's frame, without Leaflet in the module graph.
 *
 * ## The problem this file is the answer to
 *
 * `react-leaflet` reads `window` at module scope. So any route that imported it — even a route that
 * only rendered a *fallback list* beside it — could not be server-rendered: the server threw
 * `window is not defined`, TanStack Start caught it, and the whole screen silently re-rendered on the
 * client. It looked correct in a browser, which is exactly why it survived review: the only symptom
 * was that a direct GET of the operations console never used SSR, and nobody reads a response body to
 * find that out.
 *
 * Two changes fix it, and neither is sufficient alone:
 *
 * 1. **This file.** The route imports the frame from here and the fallback list from
 *    `network-list.tsx`, so neither of them pulls Leaflet into the server's module graph.
 * 2. **A dynamic import below.** Leaflet is loaded on the client, after the first render, so the
 *    server sends a stated placeholder at the map's exact height and the page does not jump.
 *
 * The counts, the footer and the fallback list are all server-rendered. Only the picture is not,
 * which is the one part that cannot be.
 */
export function MapFrame({
  hubs,
  riders,
  onFallback,
}: {
  readonly hubs: readonly MapHub[];
  readonly riders: readonly MapRider[];
  readonly onFallback: (reason: string) => void;
}) {
  const [Map, setMap] = useState<typeof NetworkMap | null>(null);

  useEffect(() => {
    let live = true;
    void import('./network-map.tsx').then((module) => {
      if (live) setMap(() => module.NetworkMap);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!Map) {
    // Same height as the map, so nothing moves when it arrives, and it says what it is doing rather
    // than showing an empty frame that reads as "no positions".
    return (
      <div
        className="flex h-[460px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500"
        role="status"
      >
        Loading the network map…
      </div>
    );
  }

  return <Map hubs={hubs} riders={riders} onFallback={onFallback} />;
}
