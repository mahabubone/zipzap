import { Module, forwardRef } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { ShipmentEntity } from './shipment.entity.ts';
import { ShipmentRepository } from './shipment.repository.ts';
import { CreateShipmentService } from './create-shipment.service.ts';
import { ShipmentLookup, SHIPMENT_LOOKUP } from './shipment.lookup.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { TrackingModule } from '../tracking/tracking.module.ts';
import { PricingModule } from '../pricing/pricing.module.ts';
import { CodModule } from '../cod/cod.module.ts';
import { IdentityModule } from '../identity/identity.module.ts';
import { CreateShipmentController } from './create-shipment.controller.ts';

@Module({
  imports: [
    forModule('shipment', [ShipmentEntity]),
    forwardRef(() => TrackingModule),
    PricingModule,
    CodModule,
    IdentityModule,
  ],
  controllers: [CreateShipmentController],
  providers: [
    ShipmentRepository,
    CreateShipmentService,
    AppendTrackingEventService,
    { provide: SHIPMENT_LOOKUP, useClass: ShipmentLookup },
  ],
  exports: [SHIPMENT_LOOKUP],
})
export class ShipmentModule {}
