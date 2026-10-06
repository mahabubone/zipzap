/**
 * AssignRider — the synchronous cross-module path, done the sanctioned way.
 *
 * Pickup needs a rider; it must not read rider's tables (ADR-0002). So pickup calls this
 * injected service with the job it holds, and gets back a rider id plus the auditable reasons.
 * The owning module exposes a contract; ownership of the data never moves.
 *
 * Two writes, one transaction: rider status -> ON_PICKUP and currentJobId set. The pickup side
 * updates its own record in its own transaction — neither writes to the other's table.
 *
 * Phase 5 rung 5: the assignment records the pool load before and after, so the utilisation
 * KPI is measured and the before/after is auditable.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import {
  isAssignable,
  rank,
  poolLoad,
  type AssignmentCandidate,
  type RiderStatus,
} from './rules/rider.ts';
import { RiderRepository } from './rider.repository.ts';

export interface AssignRiderInput {
  readonly jobId: string;
  readonly candidates: readonly AssignmentCandidate[];
  readonly riderZone?: string;
}

export interface AssignedRider {
  readonly riderId: string;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly previousStatus: RiderStatus;
  /** Pool-wide load before the assignment. */
  readonly poolLoadBefore: { readonly meanLoadFactor: number; readonly maxLoadFactor: number };
  /** Load factor of the chosen rider after the assignment. */
  readonly chosenLoadFactorAfter: number;
}

@Injectable()
export class AssignRiderService {
  constructor(
    @InjectDataSource('rider') private readonly riderDataSource: DataSource,
    @Inject(RiderRepository) private readonly riders: RiderRepository,
  ) {}

  async assign(input: AssignRiderInput): Promise<AssignedRider> {
    // Zone and vehicle filtering arrive with the hub/network modules. Until then every
    // candidate reaches scoring, which keeps the first implementation explainable.
    const ranked = rank(input.candidates);
    const best = ranked[0];
    if (!best) {
      throw new ResourceNotFoundError('No eligible rider is available for this job.');
    }

    return this.riderDataSource.transaction(async (manager) => {
      const rider = await this.riders.findByIdForUpdate(manager, best.riderId);
      if (!rider) {
        throw new ResourceNotFoundError('Assigned rider no longer exists.');
      }
      if (!isAssignable(rider.status as RiderStatus)) {
        // Lost the race between scoring and locking: another dispatcher got there first.
        throw new ResourceNotFoundError('Rider is no longer available.');
      }

      const previousStatus = rider.status as RiderStatus;
      const poolBefore = poolLoad(input.candidates);
      rider.status = 'ON_PICKUP';
      rider.currentJobId = input.jobId;
      await this.riders.save(manager, rider);

      const chosenLoadFactorAfter = Math.min(1, (best.activeJobs + 1) / best.capacity);

      return {
        riderId: rider.id,
        score: best.score,
        reasons: best.reasons,
        previousStatus,
        poolLoadBefore: {
          meanLoadFactor: poolBefore.meanLoadFactor,
          maxLoadFactor: poolBefore.maxLoadFactor,
        },
        chosenLoadFactorAfter,
      };
    });
  }
}
