import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { PickupEntity } from './pickup.entity.ts';
import { PickupRepository } from './pickup.repository.ts';
import { RequestPickupService } from './request-pickup.service.ts';
import { RequestPickupController } from './request-pickup.controller.ts';
import { AssignPickupService } from './assign-pickup.service.ts';
import { AssignPickupController } from './assign-pickup.controller.ts';
import { ListPickupsService } from './list-pickups.service.ts';
import { ListPickupsController } from './list-pickups.controller.ts';
import { ScanParcelService } from './scan-parcel.service.ts';
import { TrackingModule } from '../tracking/tracking.module.ts';
import { IdentityModule } from '../identity/identity.module.ts';
import { RiderModule } from '../rider/rider.module.ts';
import { ShipmentModule } from '../shipment/shipment.module.ts';

@Module({
  imports: [
    forModule('pickup', [PickupEntity]),
    TrackingModule,
    IdentityModule,
    RiderModule,
    // The advance contract: pickup moves the parcel's aggregate status with
    // every request/assign/scan. Shipment never imports pickup — one direction.
    ShipmentModule,
  ],
  controllers: [RequestPickupController, AssignPickupController, ListPickupsController],
  providers: [
    PickupRepository,
    RequestPickupService,
    AssignPickupService,
    ListPickupsService,
    ScanParcelService,
  ],
  exports: [ScanParcelService],
})
export class PickupModule {}
