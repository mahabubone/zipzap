import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { HubRepository, type HubSummary, type ParcelPresence } from './hub.repository.ts';

/**
 * HubConsoleService — the reads a hub console needs, and nothing else.
 *
 * Two questions, and they are the whole of it:
 *
 *   1. which hubs are there, and how busy is each?
 *   2. what is waiting at THIS hub, and what gesture does each parcel need next?
 *
 * `hubCode` comes from the path, not a body field, and is resolved through `hub.hubs` — so an
 * unknown hub is a 404 that says so, rather than an empty list that looks like a quiet shift.
 * That distinction is the entire reason this service exists: a console that renders "nothing waiting"
 * for a mistyped hub code has told an operator the floor is clear when it is not.
 *
 * Owns its transaction so both reads describe one instant. A hub list showing 12 parcels next to a
 * parcel list showing 9 is a screen an operator cannot act on.
 */
@Injectable()
export class HubConsoleService {
  constructor(
    @InjectDataSource('hub') private readonly hubDataSource: DataSource,
    @Inject(HubRepository) private readonly hubs: HubRepository,
  ) {}

  /** Every hub with its current load. */
  listHubs(): Promise<HubSummary[]> {
    return this.hubDataSource.transaction((manager) => this.hubs.listWithLoad(manager));
  }

  /** What is waiting at one hub, newest scan first. */
  async parcelsAt(
    hubCode: string,
    limit?: number,
  ): Promise<{
    readonly hub: HubSummary;
    readonly parcels: ParcelPresence[];
  }> {
    return this.hubDataSource.transaction(async (manager) => {
      const row = await this.hubs.findByCode(manager, hubCode);
      if (!row) throw new ResourceNotFoundError(`Hub "${hubCode}" not found.`);
      const parcels = await this.hubs.parcelsAt(manager, row.id, limit ?? 100);
      const hub: HubSummary = { ...row, countAtHub: parcels.length };
      return { hub, parcels };
    });
  }
}
