import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { PickupEntity } from './pickup.entity.ts';
import { PickupRepository } from './pickup.repository.ts';
import { RequestPickupService } from './request-pickup.service.ts';
import { RequestPickupController } from './request-pickup.controller.ts';
import { AssignPickupService } from './assign-pickup.service.ts';
import { AssignPickupController } from './assign-pickup.controller.ts';
import { TrackingModule } from '../tracking/tracking.module.ts';
import { IdentityModule } from '../identity/identity.module.ts';
import { RiderModule } from '../rider/rider.module.ts';

@Module({
  imports: [forModule('pickup', [PickupEntity]), TrackingModule, IdentityModule, RiderModule],
  controllers: [RequestPickupController, AssignPickupController],
  providers: [PickupRepository, RequestPickupService, AssignPickupService],
})
export class PickupModule {}
