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
import { ShipmentLookup, SHIPMENT_LOOKUP } from '../shipment/shipment.lookup.ts';
import { ShipmentAdvanceService } from '../shipment/advance-shipment.service.ts';
import { CollectCodService } from '../cod/collect-cod.service.ts';
import { assertTransition, type DeliveryStatus } from './rules/delivery.ts';
import { shipmentsDeliveredTotal } from '../../common/metrics';

@Injectable()
export class AdvanceDeliveryService {
  constructor(
    @InjectDataSource('delivery') private readonly deliveryDataSource: DataSource,
    @Inject(DeliveryRepository) private readonly jobs: DeliveryRepository,
    @Inject(AppendTrackingEventService) private readonly tracking: AppendTrackingEventService,
    @Inject(SHIPMENT_LOOKUP) private readonly shipments: ShipmentLookup,
    @Inject(ShipmentAdvanceService) private readonly advance: ShipmentAdvanceService,
    @Inject(CollectCodService) private readonly cod: CollectCodService,
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

      // The parcel itself heads out: AT_DESTINATION_HUB → OUT_FOR_DELIVERY.
      await this.advance.advance(manager, job.shipmentId, 'OUT_FOR_DELIVERY');

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
        payload: {
          shipmentId: job.shipmentId,
          riderId: job.riderId,
          merchantId: await this.shipments.findMerchantId(job.shipmentId),
        },
      });

      return job.status as DeliveryStatus;
    });
  }

  async complete(
    jobId: string,
    command: { collectedMinor: number; idempotencyKey: string; actorId: string | null },
  ): Promise<DeliveryStatus> {
    return this.deliveryDataSource.transaction(async (manager) => {
      const job = await this.jobs.findByIdForUpdate(manager, jobId);
      if (!job) throw new ResourceNotFoundError('Delivery job not found.');

      // ATTEMPTED -> DELIVERED via the machine: OUT_FOR_DELIVERY must pass through ATTEMPTED
      // first (see record-attempt), so a job that was never attempted 409s here instead of
      // inventing delivery history.
      assertTransition(job.status as DeliveryStatus, 'ATTEMPTED');
      job.status = 'ATTEMPTED';
      await this.jobs.save(manager, job);
      assertTransition('ATTEMPTED', 'DELIVERED');
      job.status = 'DELIVERED';
      await this.jobs.save(manager, job);

      // The parcel is delivered. A retryable attempt parked it in RETRY_SCHEDULED,
      // and the machine has no RETRY_SCHEDULED -> DELIVERED edge: the rider has to
      // be "out again" first, the same hop record-attempt walks in reverse. Without
      // this, a success after a retry — failed-then-delivered — 409s on an edge
      // that ought to be the story's happy ending.
      const statuses = await this.advance.statuses(manager, [job.shipmentId]);
      if (statuses[job.shipmentId] === 'RETRY_SCHEDULED') {
        await this.advance.advance(manager, job.shipmentId, 'OUT_FOR_DELIVERY');
      }
      await this.advance.advance(manager, job.shipmentId, 'DELIVERED');

      const now = new Date();
      await this.tracking.append(manager, {
        id: randomUUID(),
        shipmentId: job.shipmentId,
        eventType: 'DELIVERED',
        occurredAt: now,
        actorType: 'RIDER',
        actorId: command.actorId,
        metadata: { jobId: job.id, completed: true },
      });

      await appendOutbox(manager, {
        type: 'DeliveryCompleted',
        aggregateType: 'delivery',
        aggregateId: job.id,
        payload: {
          shipmentId: job.shipmentId,
          riderId: job.riderId,
          merchantId: await this.shipments.findMerchantId(job.shipmentId),
        },
      });
      shipmentsDeliveredTotal.inc();

      // COD is collected through the injected contract, never by reading cod.records:
      // expected amount from the frozen quote, collected amount from the rider's report.
      // Zero-COD shipments skip collection — EnsureCodRecord created no record for them.
      const codAmount = await this.shipments.findCodAmount(job.shipmentId);
      if (codAmount !== null && codAmount.amountMinor > 0) {
        await this.cod.execute({
          shipmentId: job.shipmentId,
          collectedMinor: command.collectedMinor,
          idempotencyKey: `delivery-complete:${job.id}`,
          actorId: command.actorId,
        });
      }

      return job.status as DeliveryStatus;
    });
  }
}
