/**
 * Rider utilisation — a read-only KPI surface over the rider module's own schema.
 *
 * Phase 5 rung 5: utilisation measured first, then optimised. This service computes the
 * currently observed load factor and pool utilisation from the `riders` table. It must never
 * write: the KPI is a projection, not a decision.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { RiderEntity } from './rider.entity.ts';
import { loadFactor, poolLoad } from './rules/rider.ts';
import { RiderRepository } from './rider.repository.ts';

export interface RiderLoad {
  readonly riderId: string;
  readonly capacity: number;
  readonly activeJobs: number;
  /** 0..1 — current load factor. */
  readonly loadFactor: number;
}

export interface PoolUtilisation {
  readonly totalCapacity: number;
  readonly inUseCapacity: number;
  readonly loadFactor: number;
  readonly meanLoadFactor: number;
  readonly maxLoadFactor: number;
  readonly minLoadFactor: number;
}

/**
 * Load factor = active jobs / capacity. Here "active" means a job already assigned to this
 * rider (tracked by `currentJobId`) — precise active-job counts are supplied by the pickup
 * module when scoring.
 */
function riderLoad(rider: {
  id: string;
  capacity: number;
  currentJobId: string | null;
}): RiderLoad {
  return {
    riderId: rider.id,
    capacity: rider.capacity,
    activeJobs: rider.currentJobId ? 1 : 0,
    loadFactor: loadFactor(rider.currentJobId ? 1 : 0, rider.capacity),
  };
}

@Injectable()
export class UtilisationService {
  constructor(
    @InjectDataSource('rider') private readonly riderDataSource: DataSource,
    @Inject(RiderRepository) private readonly riders: RiderRepository,
  ) {}

  /** Current load factor for one rider. Returns null for unknown or malformed ids. */
  async getRiderLoad(riderId: string): Promise<RiderLoad | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(riderId)) {
      return null;
    }
    return this.riderDataSource.transaction(async (manager) => {
      const rider = await this.riders.findById(manager, riderId);
      if (!rider) return null;
      return riderLoad(rider);
    });
  }

  /** Pool-wide utilisation across all riders (assignable + active). */
  async getPoolLoad(): Promise<PoolUtilisation> {
    return this.riderDataSource.transaction(async (manager) => {
      const riders = await manager.getRepository(RiderEntity).find();
      const load = poolLoad(riders.map(riderLoad));
      return {
        totalCapacity: load.totalCapacity,
        inUseCapacity: load.inUseCapacity,
        loadFactor: load.inUseCapacity / load.totalCapacity,
        meanLoadFactor: load.meanLoadFactor,
        maxLoadFactor: load.maxLoadFactor,
        minLoadFactor: load.minLoadFactor,
      };
    });
  }
}
