/**
 * ScanParcelService — "scan required per parcel to complete", made real.
 *
 * A rider scans one parcel at a time: the shipment advances to PICKED_UP
 * through the advance contract, a PICKED_UP tracking event is appended, the
 * pickup walks ASSIGNED → IN_PROGRESS, and — only when EVERY shipment in the
 * pickup has been scanned — IN_PROGRESS → COMPLETED.
 *
 * The completeness check reads statuses on the CALLER's manager (same
 * transaction), because the advance this call just made is not yet visible to
 * a second connection. The pickup row is locked FIRST: two riders scanning
 * different parcels of the same pickup serialise on it, so the last scan to
 * commit is the one that completes — no lost "everybody finished" moment.
 *
 * Re-scanning a picked-up parcel 409s through the shipment machine
 * (PICKED_UP → PICKED_UP is illegal): a duplicate scan is a visible error,
 * never a silent no-op and never a second event.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { ShipmentAdvanceService } from '../shipment/advance-shipment.service.ts';
import { PickupRepository } from './pickup.repository.ts';
import { assertTransition, type PickupStatus } from './rules/pickup.ts';

export interface ParcelScanResult {
  readonly pickupId: string;
  readonly shipmentId: string;
  readonly pickupStatus: PickupStatus;
  readonly scannedCount: number;
  readonly totalCount: number;
}

@Injectable()
export class ScanParcelService {
  constructor(
    @InjectDataSource('pickup') private readonly pickupDataSource: DataSource,
    @Inject(PickupRepository) private readonly pickups: PickupRepository,
    @Inject(AppendTrackingEventService) private readonly tracking: AppendTrackingEventService,
    @Inject(ShipmentAdvanceService) private readonly advance: ShipmentAdvanceService,
  ) {}

  async execute(command: {
    pickupId: string;
    shipmentId: string;
    actorId: string | null;
  }): Promise<ParcelScanResult> {
    return this.pickupDataSource.transaction(async (manager) => {
      const pickup = await this.pickups.findByIdForUpdate(manager, command.pickupId);
      if (!pickup) throw new ResourceNotFoundError('Pickup not found.');
      if (!pickup.shipmentIds.includes(command.shipmentId)) {
        throw new ResourceNotFoundError('Shipment is not part of this pickup.');
      }

      // ASSIGNED → IN_PROGRESS on the first scan (the machine has no
      // ASSIGNED → COMPLETED edge: an untouched pickup never completes).
      let status = pickup.status as PickupStatus;
      if (status === 'ASSIGNED') {
        assertTransition(status, 'IN_PROGRESS');
        status = 'IN_PROGRESS';
        pickup.status = status;
        await this.pickups.save(manager, pickup);
      }
      if (status !== 'IN_PROGRESS') {
        assertTransition(status, 'IN_PROGRESS'); // 409: already completed / cancelled
      }

      // The parcel moves, in this transaction, through the validated machine.
      await this.advance.advance(manager, command.shipmentId, 'PICKED_UP');
      await this.tracking.append(manager, {
        id: randomUUID(),
        shipmentId: command.shipmentId,
        eventType: 'PICKED_UP',
        occurredAt: new Date(),
        actorType: 'RIDER',
        actorId: command.actorId,
        metadata: { pickupId: pickup.id },
      });

      // Completeness on the SAME manager: it sees the PICKED_UP just written.
      const statuses = await this.advance.statuses(manager, pickup.shipmentIds);
      const scannedCount = pickup.shipmentIds.filter((id) => statuses[id] === 'PICKED_UP').length;
      const complete = scannedCount === pickup.shipmentIds.length;

      if (complete) {
        assertTransition('IN_PROGRESS', 'COMPLETED');
        pickup.status = 'COMPLETED';
        await this.pickups.save(manager, pickup);
        status = 'COMPLETED';
      }

      await appendOutbox(manager, {
        type: 'PickupParcelScanned',
        aggregateType: 'pickup',
        aggregateId: pickup.id,
        payload: {
          merchantId: pickup.merchantId,
          shipmentId: command.shipmentId,
          pickupStatus: status,
          scannedCount,
          totalCount: pickup.shipmentIds.length,
        },
      });

      return {
        pickupId: pickup.id,
        shipmentId: command.shipmentId,
        pickupStatus: status,
        scannedCount,
        totalCount: pickup.shipmentIds.length,
      };
    });
  }
}
