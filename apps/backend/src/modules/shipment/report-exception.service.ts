/**
 * Report an operational exception — LOST or DAMAGED — through the real state
 * machine, with the tracking event and the outbox announcement in the same
 * transaction (rules 6, 7, 8).
 *
 * `reason` doubles as the target status: the machine decides whether the
 * shipment may take the edge (LOST from line-haul only, DAMAGED from the two
 * inspection points), so a lost-while-in-the-building report 409s instead of
 * inventing a state. The tracking row carries the same reason on
 * EXCEPTION_RAISED — one public timeline event, not two silent writes.
 *
 * No money moves here. A lost COD parcel's financial write-off is finance's
 * reaction to the emitted event, never computed twice (docs/domains/cod.md).
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { ShipmentRepository } from './shipment.repository.ts';
import { assertTransition, type ShipmentStatus } from './rules/state-machine.ts';

/** Exception reasons are shipment statuses — the machine validates them as edges. */
export const EXCEPTION_REASONS = ['LOST', 'DAMAGED'] as const;
export type ExceptionReason = (typeof EXCEPTION_REASONS)[number];

export interface ReportExceptionCommand {
  readonly shipmentId: string;
  readonly reason: ExceptionReason;
  readonly note: string | null;
  readonly actorId: string | null;
}

export interface ReportedException {
  readonly shipmentId: string;
  readonly status: ShipmentStatus;
}

@Injectable()
export class ReportExceptionService {
  constructor(
    @InjectDataSource('shipment') private readonly shipmentDataSource: DataSource,
    @Inject(ShipmentRepository) private readonly shipments: ShipmentRepository,
    @Inject(AppendTrackingEventService) private readonly tracking: AppendTrackingEventService,
  ) {}

  async execute(command: ReportExceptionCommand): Promise<ReportedException> {
    return this.shipmentDataSource.transaction(async (manager) => {
      const shipment = await this.shipments.findByIdForUpdate(manager, command.shipmentId);
      if (!shipment) throw new ResourceNotFoundError('Shipment not found.');

      assertTransition(shipment.status as ShipmentStatus, command.reason);
      shipment.status = command.reason;
      await this.shipments.save(manager, shipment);

      const now = new Date();
      await this.tracking.append(manager, {
        id: randomUUID(),
        shipmentId: shipment.id,
        eventType: 'EXCEPTION_RAISED',
        occurredAt: now,
        actorType: 'OPS',
        actorId: command.actorId,
        metadata: {
          reason: command.reason,
          note: command.note,
          trackingCode: shipment.trackingCode,
        },
      });

      await appendOutbox(manager, {
        type: 'ShipmentExceptionRaised',
        aggregateType: 'shipment',
        aggregateId: shipment.id,
        payload: {
          shipmentId: shipment.id,
          merchantId: shipment.merchantId,
          trackingCode: shipment.trackingCode,
          reason: command.reason,
          note: command.note,
        },
        occurredAt: now,
      });

      return { shipmentId: shipment.id, status: command.reason };
    });
  }
}
