import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { ShipmentModule } from '../shipment/shipment.module.ts';
import { TrackingModule } from '../tracking/tracking.module.ts';
import { HubScanService } from './hub-scan.service.ts';
import { HubScanController } from './hub-scan.controller.ts';
import { HubRepository } from './hub.repository.ts';
import { HubConsoleService } from './hub-console.service.ts';
import { HubConsoleController } from './hub-console.controller.ts';
import { HubStaffService } from './hub-staff.service.ts';
import { HubStaffController } from './hub-staff.controller.ts';
import { IdentityModule } from '../identity/identity.module.ts';

/**
 * hub — the `hub` schema owner. Rung 2b shipped the `hubs` table (migration
 * 0025, seeded); the flagship story added the scan workflow: inbound → sort →
 * outbound → departed → arrived, advancing the shipment through the machine
 * via shipment's advance contract and appending tracking events directly.
 *
 * One direction only: hub imports shipment + tracking; neither imports hub.
 * Staff, capacity and schedules arrive with their first consumer.
 *
 * The hub console added the reads (`GET /v1/hubs`, `GET /v1/hubs/:hubCode/parcels`) and, with
 * migration 0040, the table they read: `hub.parcel_presence`. That table is the first thing this
 * module has written about where a parcel IS, as opposed to what was done to it — the scan used
 * to validate a `hubCode` and throw the row away, which left "what is waiting at my hub"
 * unanswerable and the console with nothing to render.
 */
@Module({
  imports: [forModule('hub', []), ShipmentModule, TrackingModule, IdentityModule],
  providers: [HubScanService, HubRepository, HubConsoleService, HubStaffService],
  controllers: [HubScanController, HubConsoleController, HubStaffController],
  exports: [HubScanService, HubRepository],
})
export class HubModule {}
