/**
 * CreateDeliveryJob — opens a delivery job for a shipment under a rider.
 *
 * Born ASSIGNED when a rider is attached at creation, CREATED when it is not. Either way the
 * job belongs to exactly one shipment — a return references the original, never a second parcel.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { hashRequest } from '../../common/idempotency.ts';
import { InvalidIdempotencyKeyError } from '../../common/domain-error.ts';
import { claim } from '../system/idempotency.store.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { DeliveryRepository } from './delivery.repository.ts';
import type { DeliveryStatus } from './rules/delivery.ts';

export interface CreateDeliveryCommand {
  readonly shipmentId: string;
  readonly riderId: string | null;
  readonly idempotencyKey: string;
  readonly actorId: string | null;
}

export interface CreatedDeliveryJob {
  readonly id: string;
  readonly shipmentId: string;
  readonly riderId: string | null;
  readonly status: DeliveryStatus;
}

const RESPONSE_META = { statusCode: 201 };

@Injectable()
export class CreateDeliveryService {
  constructor(
    @InjectDataSource('delivery') private readonly deliveryDataSource: DataSource,
    @Inject(DeliveryRepository) private readonly jobs: DeliveryRepository,
  ) {}

  async execute(command: CreateDeliveryCommand): Promise<{
    result: CreatedDeliveryJob;
    replayed: boolean;
  }> {
    const requestHash = hashRequest({ shipmentId: command.shipmentId, riderId: command.riderId });

    return this.deliveryDataSource.transaction(async (manager) => {
      const claimed = await claim(
        manager,
        { scope: 'delivery.create', merchantId: null, key: command.idempotencyKey },
        requestHash,
      );

      if (claimed.decision.outcome === 'key_reuse') {
        throw new InvalidIdempotencyKeyError(
          'This Idempotency-Key was used with a different request body.',
        );
      }
      if (claimed.decision.outcome === 'replay') {
        return { result: claimed.decision.responseBody as CreatedDeliveryJob, replayed: true };
      }

      const now = new Date();
      const job = {
        id: randomUUID(),
        shipmentId: command.shipmentId,
        riderId: command.riderId,
        status: (command.riderId ? 'ASSIGNED' : 'CREATED') as DeliveryStatus,
        attemptsMade: 0,
        lastFailureReason: null as string | null,
        createdAt: now,
        updatedAt: now,
      };
      const saved = await this.jobs.insert(manager, job as never);

      await appendOutbox(manager, {
        type: 'DeliveryJobCreated',
        aggregateType: 'delivery',
        aggregateId: saved.id,
        payload: { shipmentId: saved.shipmentId, riderId: saved.riderId, status: saved.status },
      });

      const result: CreatedDeliveryJob = {
        id: saved.id,
        shipmentId: saved.shipmentId,
        riderId: saved.riderId,
        status: saved.status as DeliveryStatus,
      };
      await claimed.complete(RESPONSE_META.statusCode, result);

      return { result, replayed: false };
    });
  }
}
