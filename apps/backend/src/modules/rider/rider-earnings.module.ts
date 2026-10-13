/**
 * RiderEarningsModule — serves the rider app's earnings projection.
 *
 * Kept separate from RiderModule because it needs DeliveryModule (to read delivery.jobs).
 * Nothing imports RiderEarningsModule except AppModule.
 */

import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module.ts';
import { IdentityModule } from '../identity/identity.module.ts';
import { RiderEarningsController } from './rider-earnings.controller.ts';

@Module({
  imports: [DeliveryModule, IdentityModule],
  controllers: [RiderEarningsController],
})
export class RiderEarningsModule {}
