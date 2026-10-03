/**
 * Accept + dispatch — the two rider-workflow edges with no extra business logic.
 *
 * ASSIGNED -> ACCEPTED (rider takes the job) and ACCEPTED -> OUT_FOR_DELIVERY (rider heads out)
 * are pure status moves: lock, assert, save, emit. No scoring, no rider call, no idempotency
 * key needed beyond the caller's own retry safety — each edge is itself idempotent because the
 * machine rejects repeating it (ACCEPTED -> ACCEPTED is illegal, so a retried accept 409s
 * instead of double-applying).
 *
 * Only dispatch writes a tracking event: accept is internal rider workflow, while OUT_FOR_DELIVERY
 * is customer-meaningful movement. Both write outbox events.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { DeliveryRepository } from './delivery.repository.ts';
import { assertTransition, type DeliveryStatus } from './rules/delivery.ts';

@Injectable()
export class AdvanceDeliveryService {
  constructor(
    @InjectDataSource('delivery') private readonly deliveryDataSource: DataSource,
    @Inject(DeliveryRepository) private readonly jobs: DeliveryRepository,
    @Inject(AppendTrackingEventService) private readonly tracking: AppendTrackingEventService,
  ) {}

  async accept(jobId: string): Promise<DeliveryStatus> {
    return this.deliveryDataSource.transaction(async (manager) => {
      const job = await this.jobs.findByIdForUpdate(manager, jobId);
      if (!job) throw new ResourceNotFoundError('Delivery job not found.');

      assertTransition(job.status as DeliveryStatus, 'ACCEPTED');
      job.status = 'ACCEPTED';
      await this.jobs.save(manager, job);

      await appendOutbox(manager, {
        type: 'DeliveryAccepted',
        aggregateType: 'delivery',
        aggregateId: job.id,
        payload: { shipmentId: job.shipmentId, riderId: job.riderId },
      });

      return job.status as DeliveryStatus;
    });
  }

  async dispatch(jobId: string, actorId: string | null): Promise<DeliveryStatus> {
    return this.deliveryDataSource.transaction(async (manager) => {
      const job = await this.jobs.findByIdForUpdate(manager, jobId);
      if (!job) throw new ResourceNotFoundError('Delivery job not found.');

      assertTransition(job.status as DeliveryStatus, 'OUT_FOR_DELIVERY');
      job.status = 'OUT_FOR_DELIVERY';
      await this.jobs.save(manager, job);

      const now = new Date();
      await this.tracking.append(manager, {
        id: randomUUID(),
        shipmentId: job.shipmentId,
        eventType: 'OUT_FOR_DELIVERY',
        occurredAt: now,
        actorType: 'RIDER',
        actorId,
        metadata: { jobId: job.id },
      });

      await appendOutbox(manager, {
        type: 'DeliveryOutForDelivery',
        aggregateType: 'delivery',
        aggregateId: job.id,
        payload: { shipmentId: job.shipmentId, riderId: job.riderId },
      });

      return job.status as DeliveryStatus;
    });
  }
}
