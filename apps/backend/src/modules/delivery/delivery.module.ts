import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { DeliveryJobEntity } from './delivery.entity.ts';
import { DeliveryAttemptEntity } from './delivery-attempt.entity.ts';
import { DeliveryProofEntity } from './delivery-proof.entity.ts';
import { DeliveryRepository } from './delivery.repository.ts';
import { DeliveryProofService } from './delivery-proof.service.ts';
import { RecordAttemptService } from './record-attempt.service.ts';
import { CreateDeliveryService } from './create-delivery.service.ts';
import { AdvanceDeliveryService } from './advance-delivery.service.ts';
import { RecordAttemptController } from './record-attempt.controller.ts';
import { CreateDeliveryController } from './create-delivery.controller.ts';
import { AdvanceDeliveryController } from './advance-delivery.controller.ts';
import { DeliveryProofController } from './delivery-proof.controller.ts';
import { TrackingModule } from '../tracking/tracking.module.ts';
import { IdentityModule } from '../identity/identity.module.ts';
import { ShipmentModule } from '../shipment/shipment.module.ts';
import { CodModule } from '../cod/cod.module.ts';

@Module({
  imports: [
    forModule('delivery', [DeliveryJobEntity, DeliveryAttemptEntity, DeliveryProofEntity]),
    TrackingModule,
    IdentityModule,
    // One direction only: delivery reads shipment facts and triggers COD collect.
    // Neither shipment nor cod imports delivery, so no forwardRef is needed.
    ShipmentModule,
    CodModule,
  ],
  controllers: [
    RecordAttemptController,
    CreateDeliveryController,
    AdvanceDeliveryController,
    DeliveryProofController,
  ],
  providers: [
    DeliveryRepository,
    RecordAttemptService,
    CreateDeliveryService,
    AdvanceDeliveryService,
    DeliveryProofService,
  ],
  exports: [DeliveryRepository],
})
export class DeliveryModule {}
