/**
 * RegisterRider — onboarding only. A rider is born AVAILABLE unless suspended at creation.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { RiderRepository } from './rider.repository.ts';
import type { RiderStatus } from './rules/rider.ts';

export interface RegisterRiderCommand {
  readonly displayName: string;
  readonly phone: string;
  readonly capacity?: number;
}

export interface RegisteredRider {
  readonly id: string;
  readonly status: RiderStatus;
}

@Injectable()
export class RegisterRiderService {
  constructor(
    @InjectDataSource('rider') private readonly riderDataSource: DataSource,
    @Inject(RiderRepository) private readonly riders: RiderRepository,
  ) {}

  async execute(command: RegisterRiderCommand): Promise<RegisteredRider> {
    return this.riderDataSource.transaction(async (manager) => {
      const now = new Date();
      const saved = await this.riders.insert(manager, {
        id: randomUUID(),
        displayName: command.displayName,
        phone: command.phone,
        status: 'AVAILABLE',
        lastKnownLatitude: null,
        lastKnownLongitude: null,
        lastKnownAt: null,
        currentJobId: null,
        capacity: command.capacity ?? 3,
        createdAt: now,
        updatedAt: now,
      });
      return { id: saved.id, status: saved.status as RiderStatus };
    });
  }
}
