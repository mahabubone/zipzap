import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { ShipmentModule } from '../shipment/shipment.module.ts';
import { TrackingModule } from '../tracking/tracking.module.ts';
import { HubScanService } from './hub-scan.service.ts';
import { HubRepository } from './hub.repository.ts';

/**
 * hub — the `hub` schema owner. Rung 2b shipped the `hubs` table (migration
 * 0025, seeded); the flagship story added the scan workflow: inbound → sort →
 * outbound → departed → arrived, advancing the shipment through the machine
 * via shipment's advance contract and appending tracking events directly.
 *
 * One direction only: hub imports shipment + tracking; neither imports hub.
 * Staff, capacity and schedules arrive with their first consumer.
 */
@Module({
  imports: [forModule('hub', []), ShipmentModule, TrackingModule],
  providers: [HubScanService, HubRepository],
  exports: [HubScanService, HubRepository],
})
export class HubModule {}
