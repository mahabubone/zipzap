/**
 * RequestPickup.
 *
 * Five writes, one transaction — the same shape as CreateShipment, for the same reason:
 *
 *   1. pickup.pickups              the request, born REQUESTED
 *   2. tracking.events             the movement history
 *   3. system.outbox_events        the event to publish
 *   4. system.idempotency_keys     the retry guard
 *
 * The outbox row is written by THIS transaction, not by a hook — a hook that runs after commit
 * reintroduces the dual-write bug the outbox exists to eliminate (ADR-0005).
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { InvalidIdempotencyKeyError } from '../../common/domain-error.ts';
import { hashRequest } from '../../common/idempotency.ts';
import { claim } from '../system/idempotency.store.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { PickupRepository } from './pickup.repository.ts';
import { validateBatch, type PickupStatus } from './rules/pickup.ts';

export interface RequestPickupCommand {
  readonly merchantId: string;
  readonly shipmentIds: readonly string[];
  readonly totalWeightGrams: number;
  readonly idempotencyKey: string;
  readonly actorId: string | null;
}

export interface RequestedPickup {
  readonly id: string;
  readonly status: PickupStatus;
  readonly shipmentIds: readonly string[];
  readonly createdAt: string;
}

/** The response is what a replayed Idempotency-Key returns, byte for byte. */
const RESPONSE_META = { statusCode: 201 };

@Injectable()
export class RequestPickupService {
  constructor(
    @InjectDataSource('pickup') private readonly pickupDataSource: DataSource,
    @Inject(PickupRepository) private readonly pickups: PickupRepository,
    @Inject(AppendTrackingEventService) private readonly tracking: AppendTrackingEventService,
  ) {}

  async execute(command: RequestPickupCommand): Promise<{
    result: RequestedPickup;
    replayed: boolean;
  }> {
    // Batch bounds are business rules, validated before the transaction opens.
    validateBatch({ shipmentIds: command.shipmentIds, totalWeightGrams: command.totalWeightGrams });

    const requestHash = hashRequest({
      merchantId: command.merchantId,
      shipmentIds: [...command.shipmentIds].sort(),
      totalWeightGrams: command.totalWeightGrams,
    });

    return this.pickupDataSource.transaction(async (manager) => {
      const claimed = await claim(
        manager,
        { scope: 'pickup.request', merchantId: command.merchantId, key: command.idempotencyKey },
        requestHash,
      );

      if (claimed.decision.outcome === 'key_reuse') {
        throw new InvalidIdempotencyKeyError(
          'This Idempotency-Key was used with a different request body.',
        );
      }
      if (claimed.decision.outcome === 'replay') {
        return {
          result: claimed.decision.responseBody as RequestedPickup,
          replayed: true,
        };
      }

      const now = new Date();
      const pickup = {
        id: randomUUID(),
        merchantId: command.merchantId,
        shipmentIds: [...command.shipmentIds],
        riderId: null as string | null,
        status: 'REQUESTED' as const,
        failureReason: null as string | null,
        totalWeightGrams: command.totalWeightGrams,
        createdAt: now,
        updatedAt: now,
      };

      await this.pickups.insert(manager, pickup);

      // One tracking event per member shipment: a batch is one assignment covering many
      // parcels, but each parcel moves through its own lifecycle. Requesting is distinct from
      // assigning — PICKUP_ASSIGNED is emitted by the assignment transition, which lives here
      // as assignPickup once the rider contract exists.
      for (const shipmentId of command.shipmentIds) {
        await this.tracking.append(manager, {
          id: randomUUID(),
          shipmentId,
          eventType: 'PICKUP_REQUESTED',
          occurredAt: now,
          actorType: 'MERCHANT',
          actorId: command.actorId,
          metadata: { pickupId: pickup.id, batchSize: command.shipmentIds.length },
        });
      }

      await appendOutbox(manager, {
        type: 'PickupRequested',
        aggregateType: 'pickup',
        aggregateId: pickup.id,
        payload: {
          merchantId: pickup.merchantId,
          shipmentIds: pickup.shipmentIds,
          status: pickup.status,
        },
      });

      const result: RequestedPickup = {
        id: pickup.id,
        status: pickup.status,
        shipmentIds: pickup.shipmentIds,
        createdAt: now.toISOString(),
      };

      await claimed.complete(RESPONSE_META.statusCode, result);

      return { result, replayed: false };
    });
  }
}
