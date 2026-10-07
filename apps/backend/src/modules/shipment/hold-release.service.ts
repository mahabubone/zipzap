/**
 * Hold / release — the merchant-pause gestures the state machine already
 * knows. Hold only works from the states that can interrupt (OUT_FOR_DELIVERY,
 * DELIVERY_FAILED, RETRY_SCHEDULED, EXCEPTION): a parcel still in line-haul is
 * physically moving, not parkable. Release resumes the recorded state exactly.
 *
 * Same shape as ReportExceptionService: one transaction, row lock, machine
 * assertion, tracking event, outbox announcement.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { InvalidTransitionError, ResourceNotFoundError } from '../../common/domain-error.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { ShipmentRepository } from './shipment.repository.ts';
import { assertTransition, type ShipmentStatus } from './rules/state-machine.ts';

export interface HeldShipment {
  readonly shipmentId: string;
  readonly status: ShipmentStatus;
}

@Injectable()
export class HoldReleaseService {
  constructor(
    @InjectDataSource('shipment') private readonly shipmentDataSource: DataSource,
    @Inject(ShipmentRepository) private readonly shipments: ShipmentRepository,
    @Inject(AppendTrackingEventService) private readonly tracking: AppendTrackingEventService,
  ) {}

  async hold(command: {
    shipmentId: string;
    reason: string | null;
    actorId: string | null;
  }): Promise<HeldShipment> {
    return this.shipmentDataSource.transaction(async (manager) => {
      const shipment = await this.shipments.findByIdForUpdate(manager, command.shipmentId);
      if (!shipment) throw new ResourceNotFoundError('Shipment not found.');

      assertTransition(shipment.status as ShipmentStatus, 'ON_HOLD');
      shipment.heldFromStatus = shipment.status as ShipmentStatus;
      shipment.status = 'ON_HOLD';
      await this.shipments.save(manager, shipment);

      const now = new Date();
      await this.tracking.append(manager, {
        id: randomUUID(),
        shipmentId: shipment.id,
        eventType: 'SHIPMENT_HELD',
        occurredAt: now,
        actorType: 'OPS',
        actorId: command.actorId,
        metadata: {
          reason: command.reason,
          resumeFrom: shipment.heldFromStatus,
          trackingCode: shipment.trackingCode,
        },
      });
      await appendOutbox(manager, {
        type: 'ShipmentHeld',
        aggregateType: 'shipment',
        aggregateId: shipment.id,
        payload: {
          shipmentId: shipment.id,
          merchantId: shipment.merchantId,
          trackingCode: shipment.trackingCode,
          resumeFrom: shipment.heldFromStatus,
          reason: command.reason,
        },
        occurredAt: now,
      });

      return { shipmentId: shipment.id, status: 'ON_HOLD' as const };
    });
  }

  async release(command: { shipmentId: string; actorId: string | null }): Promise<HeldShipment> {
    return this.shipmentDataSource.transaction(async (manager) => {
      const shipment = await this.shipments.findByIdForUpdate(manager, command.shipmentId);
      if (!shipment) throw new ResourceNotFoundError('Shipment not found.');
      if (shipment.status !== 'ON_HOLD' || shipment.heldFromStatus === null) {
        throw new InvalidTransitionError(shipment.status, 'RELEASE');
      }

      const resume = shipment.heldFromStatus as ShipmentStatus;
      shipment.status = resume;
      shipment.heldFromStatus = null;
      await this.shipments.save(manager, shipment);

      const now = new Date();
      await this.tracking.append(manager, {
        id: randomUUID(),
        shipmentId: shipment.id,
        eventType: 'SHIPMENT_RELEASED',
        occurredAt: now,
        actorType: 'OPS',
        actorId: command.actorId,
        metadata: { resumedTo: resume, trackingCode: shipment.trackingCode },
      });
      await appendOutbox(manager, {
        type: 'ShipmentReleased',
        aggregateType: 'shipment',
        aggregateId: shipment.id,
        payload: {
          shipmentId: shipment.id,
          merchantId: shipment.merchantId,
          trackingCode: shipment.trackingCode,
          resumedTo: resume,
        },
        occurredAt: now,
      });

      return { shipmentId: shipment.id, status: resume };
    });
  }
}
