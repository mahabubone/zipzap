import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { DeliveryJobEntity } from './delivery.entity.ts';
import { DeliveryAttemptEntity } from './delivery-attempt.entity.ts';
import { DeliveryRepository } from './delivery.repository.ts';
import { RecordAttemptService } from './record-attempt.service.ts';
import { CreateDeliveryService } from './create-delivery.service.ts';
import { AdvanceDeliveryService } from './advance-delivery.service.ts';
import { RecordAttemptController } from './record-attempt.controller.ts';
import { CreateDeliveryController } from './create-delivery.controller.ts';
import { AdvanceDeliveryController } from './advance-delivery.controller.ts';
import { TrackingModule } from '../tracking/tracking.module.ts';
import { IdentityModule } from '../identity/identity.module.ts';

@Module({
  imports: [
    forModule('delivery', [DeliveryJobEntity, DeliveryAttemptEntity]),
    TrackingModule,
    IdentityModule,
  ],
  controllers: [RecordAttemptController, CreateDeliveryController, AdvanceDeliveryController],
  providers: [
    DeliveryRepository,
    RecordAttemptService,
    CreateDeliveryService,
    AdvanceDeliveryService,
  ],
})
export class DeliveryModule {}
