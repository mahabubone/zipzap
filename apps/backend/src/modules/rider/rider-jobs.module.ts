/**
 * RiderJobsModule — serves the rider app's job feed.
 *
 * Kept separate from RiderModule because the feed aggregates pickup and delivery
 * rows: importing PickupModule into RiderModule would close a pickup↔rider module
 * cycle (pickup already imports RiderModule for AssignRiderService). This module
 * sits at the top of that edge — it imports both, like DashboardModule does for
 * the control tower. Nothing imports RiderJobsModule except AppModule.
 */

import { Module } from '@nestjs/common';
import { PickupModule } from '../pickup/pickup.module.ts';
import { DeliveryModule } from '../delivery/delivery.module.ts';
import { IdentityModule } from '../identity/identity.module.ts';
import { ShipmentModule } from '../shipment/shipment.module.ts';
import { RiderJobsController } from './rider-jobs.controller.ts';

@Module({
  imports: [PickupModule, DeliveryModule, IdentityModule, ShipmentModule],
  controllers: [RiderJobsController],
})
export class RiderJobsModule {}
