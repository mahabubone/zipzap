/**
 * CancelShipment: lock, assert CANCELLED is legal from here, save, emit.
 *
 * Follows the AdvanceDeliveryService shape: one transaction, row lock,
 * machine assertion, tracking event, outbox event. The machine rejects
 * cancelling a DELIVERED parcel (409 INVALID_TRANSITION) — that is a return,
 * not a cancel. Merchant scope is enforced: a stranger's id 404s, because a
 * 403 would confirm the shipment exists.
 *
 * Cancel is idempotent-safe by construction, not by key: CANCELLED has no
 * outgoing edges, so a retried cancel 409s instead of double-applying.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { ShipmentRepository } from './shipment.repository.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { assertTransition, type ShipmentStatus } from './rules/state-machine.ts';

export interface CancelledShipment {
  readonly id: string;
  readonly trackingCode: string;
  readonly status: 'CANCELLED';
}

@Injectable()
export class CancelShipmentService {
  constructor(
    @InjectDataSource('shipment') private readonly shipmentDataSource: DataSource,
    @Inject(ShipmentRepository) private readonly shipments: ShipmentRepository,
    @Inject(AppendTrackingEventService) private readonly tracking: AppendTrackingEventService,
  ) {}

  async execute(merchantId: string, shipmentId: string): Promise<CancelledShipment> {
    return this.shipmentDataSource.transaction(async (manager) => {
      const shipment = await this.shipments.findByIdForUpdate(manager, shipmentId);
      if (!shipment || shipment.merchantId !== merchantId) {
        throw new ResourceNotFoundError('Shipment not found.');
      }

      assertTransition(shipment.status as ShipmentStatus, 'CANCELLED');
      shipment.status = 'CANCELLED';
      await this.shipments.save(manager, shipment);

      const now = new Date();
      await this.tracking.append(manager, {
        id: randomUUID(),
        shipmentId: shipment.id,
        eventType: 'SHIPMENT_CANCELLED',
        occurredAt: now,
        actorType: 'MERCHANT',
        actorId: null,
        metadata: { trackingCode: shipment.trackingCode },
      });

      await appendOutbox(manager, {
        type: 'ShipmentCancelled',
        aggregateType: 'shipment',
        aggregateId: shipment.id,
        payload: {
          merchantId: shipment.merchantId,
          trackingCode: shipment.trackingCode,
          status: 'CANCELLED',
        },
      });

      return { id: shipment.id, trackingCode: shipment.trackingCode, status: 'CANCELLED' };
    });
  }
}
