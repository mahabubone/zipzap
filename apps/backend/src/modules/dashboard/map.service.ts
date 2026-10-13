/**
 * GET /v1/control-tower/map — everything with a coordinate, in one read.
 *
 * This is the row the plan calls the one we would beat all three competitors on, so it is worth being
 * precise about what it is: **hubs and riders**. Not parcels. A parcel has no coordinate of its own —
 * the only places anything in this network has ever had a latitude are the seeded hubs and the
 * phones. Pinning parcels would mean inferring a position from a status enum, and an inferred
 * position on a map is a lie an operator acts on.
 *
 * Two single-schema queries, one per owning module, taken as close to one instant as the driver
 * allows. No join across schemas (rule 2) and no query that reaches into `shipment.*` for this — the
 * per-zone counts come from each module's own repository, exactly as `DashboardService` already does.
 *
 * `staleSeconds` is on every marker rather than hidden. A rider whose last ping was 20 minutes ago is
 * not "at" that dot, and a map that cannot say so is a map that lies quietly.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { RiderRepository } from '../rider/rider.repository.ts';
import { HubRepository } from '../hub/hub.repository.ts';

export interface MapHub {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly networkZone: string | null;
  readonly lng: number;
  readonly lat: number;
  readonly parcelsWaiting: number;
}

export interface MapRider {
  readonly id: string;
  readonly displayName: string;
  readonly status: string;
  readonly lng: number;
  readonly lat: number;
  /**
   * When the last ping was, as well as how stale it is.
   *
   * `staleSeconds` was computed on the server and is therefore correct only for the instant the
   * response was built: a board left open for ten minutes still showed the ages it had at load time,
   * and the tooltip said "last seen 1614s ago" on a screen whose whole job is saying how old the dot
   * is. A timestamp cannot go out of date, so the client derives the age from it.
   */
  readonly lastSeenAt: string | null;
  /** Seconds since the last ping. Kept for the server-side classification — live, stale, or never. */
  readonly staleSeconds: number;
  readonly currentJobId: string | null;
}

export interface NetworkMap {
  readonly hubs: readonly MapHub[];
  readonly riders: readonly MapRider[];
  /** Riders with no ping yet. Counted, not plotted — a dot at (0,0) is in the ocean. */
  readonly ridersWithoutPosition: number;
  readonly generatedAt: string;
}

interface RiderMapRow {
  id: string;
  display_name: string;
  status: string;
  lng: string;
  lat: string;
  last_known_at: Date | null;
  current_job_id: string | null;
}

@Injectable()
export class MapService {
  constructor(
    @InjectDataSource('rider') private readonly riderDs: DataSource,
    @InjectDataSource('hub') private readonly hubDs: DataSource,
    @Inject(RiderRepository) private readonly riders: RiderRepository,
    @Inject(HubRepository) private readonly hubs: HubRepository,
  ) {}

  async getMap(): Promise<NetworkMap> {
    // Two connections, so not one transaction — they are independent reads and a shared transaction
    // across two schemas is exactly the coupling rule 2 exists to prevent. Each query is internally
    // consistent; the pair is "as close to one instant as the driver allows", and the doc says so
    // rather than implying atomicity it does not have.
    const [hubRows, riderRows, unpositioned] = await Promise.all([
      this.hubDs.transaction((manager) => this.hubs.listWithLoad(manager)),
      this.riderDs.transaction((manager) => this.riders.listWithPosition(manager)),
      this.riderDs.transaction((manager) => this.riders.countWithoutPosition(manager)),
    ]);

    const now = Date.now();

    return {
      hubs: hubRows
        // A hub with no location cannot be plotted. Seeded ones all have one; a fixture-created hub
        // might not, and dropping it silently would make the map look complete when it is not.
        .filter(
          (h): h is typeof h & { lng: number; lat: number } => h.lng !== null && h.lat !== null,
        )
        .map((h) => ({
          id: h.id,
          code: h.code,
          name: h.name,
          kind: h.kind,
          networkZone: h.networkZone,
          lng: Number(h.lng),
          lat: Number(h.lat),
          parcelsWaiting: h.countAtHub,
        })),
      riders: riderRows.map((row: RiderMapRow) => ({
        id: row.id,
        displayName: row.display_name,
        status: row.status,
        lng: Number(row.lng),
        lat: Number(row.lat),
        lastSeenAt: row.last_known_at ? new Date(row.last_known_at as Date).toISOString() : null,
        staleSeconds: Math.max(
          0,
          Math.round((now - new Date(row.last_known_at as Date).getTime()) / 1000),
        ),
        currentJobId: row.current_job_id,
      })),
      ridersWithoutPosition: unpositioned,
      generatedAt: new Date(now).toISOString(),
    };
  }
}
