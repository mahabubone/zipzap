/**
 * Recording where a rider is.
 *
 * A position is not history — it is the present tense, high-frequency and short-lived — so this
 * **overwrites** `last_known_*` rather than appending. That is the one deliberate exception to rule
 * 8 in this codebase, and it is recorded here because the rule's own wording says "where it is
 * history": a rider's 400th GPS ping of the day has no operational meaning once the 401st arrives,
 * and keeping them all would make the table grow forever for no query that wants them.
 *
 * What *is* appended is the event. Every position write publishes `RiderPositionUpdated` in the same
 * transaction (rule 7), so the network's own history can answer "when did this rider cross the
 * river?" without the present-tense table ever growing.
 *
 * **Never public.** The public tracker reads `tracking.public_timeline`, a separate table that has
 * no coordinate column and no actor column, so there is no filter here to forget and nothing to
 * redact downstream. This service is guarded on `rider:sync`, a platform scope.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ResourceNotFoundError, ValidationFailedError } from '../../common/domain-error.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { RiderRepository } from './rider.repository.ts';

export interface RecordPositionCommand {
  readonly riderId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly recordedAt: Date;
  readonly accuracyMeters?: number | null;
}

export interface RiderPosition {
  readonly riderId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly recordedAt: string;
  readonly ageSeconds: number;
}

@Injectable()
export class RecordPositionService {
  constructor(
    @InjectDataSource('rider') private readonly rider: DataSource,
    @Inject(RiderRepository) private readonly riders: RiderRepository,
  ) {}

  async execute(command: RecordPositionCommand): Promise<RiderPosition> {
    // Bounds-checked here rather than trusted from a phone. A GPS chip that has lost its fix
    // reports (0, 0), which is in the Gulf of Guinea and would put a rider in the ocean on the map.
    if (command.latitude < -90 || command.latitude > 90) {
      throw new ValidationFailedError([{ path: 'latitude', message: 'must be -90..90' }]);
    }
    if (command.longitude < -180 || command.longitude > 180) {
      throw new ValidationFailedError([{ path: 'longitude', message: 'must be -180..180' }]);
    }

    return this.rider.transaction(async (manager) => {
      const row = await this.riders.findById(manager, command.riderId);
      if (!row) throw new ResourceNotFoundError(`Rider ${command.riderId} not found.`);

      // A stale ping must not overwrite a fresh one. Phones buffer offline and flush on reconnect,
      // so batches arrive out of order — and without this, a rider walking back to the hub would
      // appear to teleport backwards every time the phone found signal again.
      const previousAt = row.lastKnownAt;
      if (previousAt !== null && command.recordedAt < previousAt) {
        return {
          riderId: row.id,
          latitude: row.lastKnownLatitude as number,
          longitude: row.lastKnownLongitude as number,
          recordedAt: previousAt.toISOString(),
          ageSeconds: Math.max(0, Math.round((Date.now() - previousAt.getTime()) / 1000)),
        };
      }

      row.lastKnownLatitude = command.latitude;
      row.lastKnownLongitude = command.longitude;
      row.lastKnownAt = command.recordedAt;
      await this.riders.save(manager, row);

      await appendOutbox(manager, {
        type: 'RiderPositionUpdated',
        aggregateType: 'rider',
        aggregateId: row.id,
        payload: {
          latitude: command.latitude,
          longitude: command.longitude,
          recordedAt: command.recordedAt.toISOString(),
          accuracyMeters: command.accuracyMeters ?? null,
        },
      });

      return {
        riderId: row.id,
        latitude: command.latitude,
        longitude: command.longitude,
        recordedAt: command.recordedAt.toISOString(),
        ageSeconds: 0,
      };
    });
  }
}
