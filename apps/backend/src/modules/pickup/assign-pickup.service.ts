/**
 * AssignPickup — the synchronous cross-module path, exercised for real.
 *
 * Pickup needs a rider; it must not read rider's tables (ADR-0002). So it calls the rider
 * module's injected service with scored candidates and gets back a rider id plus the auditable
 * reasons. Ownership of the data never moves — each side writes only its own table.
 *
 * Three writes, one pickup-side transaction: pickup status + riderId, the tracking history, and
 * the outbox event. The rider side commits its own status change under the injected service.
 * A failure in either aborts with no partial state on the caller's side.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { PickupNotFoundError } from '../../common/domain-error.ts';
import { assertTransition, type PickupStatus } from './rules/pickup.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { PickupRepository } from './pickup.repository.ts';
import { AssignRiderService } from '../rider/assign-rider.service.ts';
import { ShipmentAdvanceService } from '../shipment/advance-shipment.service.ts';
import type { AssignmentCandidate } from '../rider/rules/rider.ts';
import { hashRequest } from '../../common/idempotency.ts';
import { claim } from '../system/idempotency.store.ts';
import { InvalidIdempotencyKeyError } from '../../common/domain-error.ts';

export interface AssignPickupCommand {
  readonly pickupId: string;
  /** Candidate pool scored by the rider contract. Distances/positions come from the caller. */
  readonly candidates: readonly AssignmentCandidate[];
  readonly idempotencyKey: string;
  readonly actorId: string | null;
}

export interface AssignedPickup {
  readonly pickupId: string;
  readonly riderId: string;
  readonly status: PickupStatus;
  readonly score: number;
  readonly reasons: readonly string[];
}

const RESPONSE_META = { statusCode: 200 };

@Injectable()
export class AssignPickupService {
  constructor(
    @InjectDataSource('pickup') private readonly pickupDataSource: DataSource,
    @Inject(PickupRepository) private readonly pickups: PickupRepository,
    @Inject(AppendTrackingEventService) private readonly tracking: AppendTrackingEventService,
    @Inject(AssignRiderService) private readonly riders: AssignRiderService,
    @Inject(ShipmentAdvanceService) private readonly advance: ShipmentAdvanceService,
  ) {}

  async execute(command: AssignPickupCommand): Promise<{
    result: AssignedPickup;
    replayed: boolean;
  }> {
    const requestHash = hashRequest({ pickupId: command.pickupId });

    return this.pickupDataSource.transaction(async (manager) => {
      const claimed = await claim(
        manager,
        { scope: 'pickup.assign', merchantId: null, key: command.idempotencyKey },
        requestHash,
      );

      if (claimed.decision.outcome === 'key_reuse') {
        throw new InvalidIdempotencyKeyError(
          'This Idempotency-Key was used with a different request body.',
        );
      }
      if (claimed.decision.outcome === 'replay') {
        return { result: claimed.decision.responseBody as AssignedPickup, replayed: true };
      }

      const row = await this.pickups.findByIdForUpdate(manager, command.pickupId);
      if (!row) throw new PickupNotFoundError();

      // Walk the machine edge by edge: REQUESTED -> SCHEDULED -> ASSIGNED. Scheduling is
      // automatic here (no separate dispatch step exists yet), but the machine stays the
      // authority — both edges are asserted, so an illegal source state still 409s.
      let from = row.status as PickupStatus;
      if (from === 'REQUESTED') {
        assertTransition(from, 'SCHEDULED');
        from = 'SCHEDULED';
      }
      assertTransition(from, 'ASSIGNED');

      // The injected contract: rider picks and locks; we record the id it returns.
      const assigned = await this.riders.assign({ jobId: row.id, candidates: command.candidates });

      row.riderId = assigned.riderId;
      row.status = 'ASSIGNED';
      await this.pickups.save(manager, row);

      const now = new Date();
      for (const shipmentId of row.shipmentIds) {
        await this.advance.advance(manager, shipmentId, 'PICKUP_ASSIGNED');
        await this.tracking.append(manager, {
          id: randomUUID(),
          shipmentId,
          eventType: 'PICKUP_ASSIGNED',
          occurredAt: now,
          actorType: 'OPERATIONS',
          actorId: command.actorId,
          metadata: { pickupId: row.id, riderId: assigned.riderId },
        });
      }

      await appendOutbox(manager, {
        type: 'PickupAssigned',
        aggregateType: 'pickup',
        aggregateId: row.id,
        payload: {
          merchantId: row.merchantId,
          riderId: assigned.riderId,
          score: assigned.score,
          reasons: assigned.reasons,
          shipmentIds: row.shipmentIds,
        },
      });

      const result: AssignedPickup = {
        pickupId: row.id,
        riderId: assigned.riderId,
        status: 'ASSIGNED',
        score: assigned.score,
        reasons: assigned.reasons,
      };
      await claimed.complete(RESPONSE_META.statusCode, result);

      return { result, replayed: false };
    });
  }
}
